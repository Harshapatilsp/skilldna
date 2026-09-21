import type { InteractionSource, WorkflowEvent } from '../domain';
import { normalize } from '../privacy';
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function replaySessionLog(entries: unknown[]) {
  let state: unknown;
  if (entries.length > 50_000) throw new Error('Session log entry limit exceeded.');
  for (const entry of entries) {
    if (!record(entry)) throw new Error('Invalid session log entry.');
    if (entry.kind === 0) {
      if (!record(entry.v)) throw new Error('Invalid session snapshot.');
      state = entry.v;
      continue;
    }
    if (
      !record(state) ||
      ![1, 2, 3].includes(entry.kind as number) ||
      !Array.isArray(entry.k) ||
      !entry.k.length ||
      entry.k.length > 64
    )
      throw new Error('Unsupported session log operation.');
    const keys = entry.k;
    if (
      keys.some(
        (key) =>
          !(typeof key === 'string' || (Number.isInteger(key) && key >= 0 && key <= 10_000)) ||
          ['__proto__', 'prototype', 'constructor', 'length'].includes(String(key)),
      )
    )
      throw new Error('Unsafe session log path.');
    let parent: unknown = state;
    for (const key of keys.slice(0, -1)) {
      if ((!record(parent) && !Array.isArray(parent)) || !Object.hasOwn(parent, key))
        throw new Error('Invalid session log path.');
      parent = (parent as Record<string, unknown>)[key];
    }
    if (!record(parent) && !Array.isArray(parent)) throw new Error('Invalid session log target.');
    const key = keys.at(-1)!;
    if (Array.isArray(parent) && (!Number.isInteger(key) || key < 0 || key >= parent.length))
      throw new Error('Invalid session log array index.');
    const target = parent as Record<string, unknown>;
    if (entry.kind === 1) target[key] = entry.v;
    else if (entry.kind === 3) delete target[key];
    else {
      const array = Object.hasOwn(target, key) ? target[key] : [];
      if (!Array.isArray(array) || (entry.v !== undefined && !Array.isArray(entry.v)))
        throw new Error('Invalid session log append.');
      if (entry.i !== undefined) {
        if (
          !Number.isInteger(entry.i) ||
          (entry.i as number) < 0 ||
          (entry.i as number) > array.length
        )
          throw new Error('Invalid session log truncation.');
        array.length = entry.i as number;
      }
      if (array.length + ((entry.v as unknown[] | undefined)?.length ?? 0) > 10_000)
        throw new Error('Session log array limit exceeded.');
      for (const value of (entry.v ?? []) as unknown[]) array.push(value);
      target[key] = array;
    }
  }
  return state;
}
export class ImportSource implements InteractionSource {
  readonly type = 'import' as const;
  constructor(
    private readonly contents: string,
    private readonly jsonl = false,
    private readonly batchId: string = crypto.randomUUID(),
  ) {}
  async read(): Promise<WorkflowEvent[]> {
    if (this.contents.length > 5_000_000)
      throw new Error('Import limit is 5 MB. Select a smaller file.');
    let parsed: unknown;
    try {
      parsed = this.jsonl
        ? this.contents
            .split(/\r?\n/)
            .filter((line) => line.trim())
            .map((line) => JSON.parse(line))
        : JSON.parse(this.contents);
    } catch {
      throw new Error('Invalid JSON or JSONL. No data was imported.');
    }
    if (
      this.jsonl &&
      Array.isArray(parsed) &&
      parsed.some((entry) => record(entry) && 'kind' in entry)
    )
      parsed = replaySessionLog(parsed);
    if (record(parsed) && parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1)
      throw new Error('Unsupported import schema version. Supported version: 1.');
    const root = record(parsed)
      ? (parsed.sessions ??
        parsed.conversations ??
        parsed.events ??
        parsed.messages ??
        parsed.requests)
      : parsed;
    if (!Array.isArray(root) || !root.length)
      throw new Error(
        'Unsupported format. Expected an array or an object containing sessions, conversations, events, messages, or requests.',
      );
    const events: WorkflowEvent[] = [];
    const ids = new Map<unknown, string>();
    const base = Date.now();
    const add = (raw: unknown, key: unknown) => {
      if (
        !record(raw) ||
        !['action', 'intent', 'prompt', 'response', 'content', 'text', 'message', 'request'].some(
          (field) => field in raw,
        )
      )
        throw new Error(
          'Unsupported event fields. Expected action, intent, prompt, response, text, content, message, or request.',
        );
      if (!ids.has(key)) ids.set(key, `${this.batchId}-session-${ids.size}`);
      const flattened = { ...raw };
      if (record(raw.message) && typeof raw.message.content === 'string')
        flattened.content = raw.message.content;
      if (record(raw.message) && typeof raw.message.text === 'string')
        flattened.text = raw.message.text;
      if (typeof raw.message === 'string') flattened.text = raw.message;
      if (record(raw.prompt) && typeof raw.prompt.text === 'string')
        flattened.prompt = raw.prompt.text;
      if (record(raw.request)) {
        if (typeof raw.request.text === 'string') flattened.text = raw.request.text;
        else if (typeof raw.request.message === 'string') flattened.text = raw.request.message;
        else if (record(raw.request.message) && typeof raw.request.message.text === 'string')
          flattened.text = raw.request.message.text;
        if (typeof raw.request.prompt === 'string') flattened.prompt = raw.request.prompt;
      }
      if (Array.isArray(raw.response))
        flattened.response = raw.response
          .map((part) => {
            if (typeof part === 'string') return part;
            if (record(part) && typeof part.value === 'string') return part.value;
            if (
              record(part) &&
              part.kind === 'markdownContent' &&
              record(part.content) &&
              typeof part.content.value === 'string'
            )
              return part.content.value;
            return '';
          })
          .join('\n');
      events.push(
        normalize(flattened, {
          source: 'import',
          mode: 'user-imported-content',
          sessionId: ids.get(key)!,
          id: `${this.batchId}-event-${events.length}`,
          timestamp: new Date(base + events.length * 1000).toISOString(),
        }),
      );
      if (events.length > 10_000 || ids.size > 500)
        throw new Error('Import limit exceeded: 10,000 events or 500 sessions.');
    };
    root.forEach((item, index) => {
      if (!record(item)) throw new Error('Each session or event must be an object.');
      const nested = item.events ?? item.messages ?? item.requests;
      if (nested !== undefined) {
        if (!Array.isArray(nested) || nested.length > 200)
          throw new Error('Session events must be an array of at most 200 items.');
        nested.forEach((event) => add(event, `nested-${index}`));
      } else add(item, item.sessionId ?? item.conversationId ?? 'selected-file');
    });
    if (!events.length) throw new Error('No supported events found.');
    return events;
  }
}
