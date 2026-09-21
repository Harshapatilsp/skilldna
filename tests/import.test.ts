import { expect, it } from 'vitest';
import { ImportSource } from '../packages/adapters/import';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverSessions } from '../packages/adapters/discovery';
it('replays Copilot JSONL initial, set, append, truncate and delete operations', async () => {
  const entries = [
    { kind: 0, v: { requests: [] } },
    { kind: 2, k: ['requests'], v: [{ message: { text: 'discarded text' } }] },
    { kind: 1, k: ['requests', 0, 'message', 'text'], v: 'identify root cause password=hidden' },
    { kind: 1, k: ['requests', 0, 'response'], v: [{ value: 'root cause evidence' }] },
    { kind: 2, k: ['requests'], v: [{ message: { text: 'discarded second request' } }] },
    { kind: 2, k: ['requests'], i: 1 },
    { kind: 3, k: ['requests', 0, 'response'] },
  ];
  const events = await new ImportSource(
    entries.map((entry) => JSON.stringify(entry)).join('\n'),
    true,
  ).read();
  expect(events).toHaveLength(1);
  expect(events[0].intent).toBe('identify-root-cause');
  expect(JSON.stringify(events)).not.toMatch(/hidden|discarded/);
});
it('combines multiple selected folders and deduplicates overlapping scopes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skilldna-multifolder-'));
  try {
    const first = join(root, '1'.repeat(32));
    const second = join(root, '2'.repeat(32));
    for (const workspace of [first, second]) {
      await mkdir(join(workspace, 'chatSessions'), { recursive: true });
      await writeFile(
        join(workspace, 'chatSessions', 'session.json'),
        JSON.stringify({ requests: [{ message: { text: 'identify root cause' } }] }),
      );
    }
    const result = await discoverSessions(root, [first, join(first, 'chatSessions'), second], 10);
    expect(result).toMatchObject({
      foundFiles: 2,
      importedFiles: 2,
      workspaceCount: 2,
      filesNotRead: 0,
    });
    expect(result.events).toHaveLength(2);
    expect(new Set(result.events.map((event) => event.sessionId)).size).toBe(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('includes chat sessions and copilot transcripts when a workspace folder is selected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skilldna-transcripts-'));
  try {
    const hash = join(root, 'a'.repeat(32));
    await mkdir(join(hash, 'chatSessions'), { recursive: true });
    await writeFile(
      join(hash, 'chatSessions', 'session.json'),
      JSON.stringify({ requests: [{ message: { text: 'compare configuration' } }] }),
    );
    const transcripts = join(hash, 'GitHub.copilot-chat', 'transcripts');
    await mkdir(transcripts, { recursive: true });
    await writeFile(
      join(transcripts, 'turns.jsonl'),
      JSON.stringify({
        request: { message: { text: 'identify root cause' } },
        response: [{ value: 'evidence' }],
      }),
    );
    await mkdir(join(hash, 'GitHub.copilot-chat', 'chatEditingSessions'), { recursive: true });
    await writeFile(
      join(hash, 'GitHub.copilot-chat', 'chatEditingSessions', 'x.jsonl'),
      'should not be read',
    );
    const result = await discoverSessions(root, [hash], 25);
    expect(result).toMatchObject({ foundFiles: 2, importedFiles: 2, workspaceCount: 1 });
    const intents = result.events.map((event) => event.intent);
    expect(intents).toContain('identify-root-cause');
    expect(intents).toContain('compare-configuration');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('accepts a direct transcript file and rejects other copilot-chat subfolders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skilldna-transcript-file-'));
  try {
    const hash = 'b'.repeat(32);
    const transcripts = join(root, hash, 'GitHub.copilot-chat', 'transcripts');
    await mkdir(transcripts, { recursive: true });
    const file = join(transcripts, 'one.jsonl');
    await writeFile(file, JSON.stringify({ request: { message: { text: 'prepare escalation' } } }));
    const result = await discoverSessions(root, [file], 10);
    expect(result.importedFiles).toBe(1);
    expect(result.events[0].intent).toBe('prepare-escalation');
    const editing = join(root, hash, 'GitHub.copilot-chat', 'chatEditingSessions');
    await mkdir(editing, { recursive: true });
    await expect(discoverSessions(root, [editing], 10)).rejects.toThrow(
      'Select the discovery root',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it.each([
  { kind: 1, k: ['__proto__', 'polluted'], v: true },
  { kind: 2, k: ['requests'], i: 99999999 },
  { kind: 7, k: ['requests'] },
  { kind: 1, k: ['missing', 'text'], v: 'invalid' },
])('rejects unsafe or unsupported mutation logs', async (operation) => {
  const text = JSON.stringify({ kind: 0, v: { requests: [] } }) + '\n' + JSON.stringify(operation);
  await expect(new ImportSource(text, true).read()).rejects.toThrow();
  expect(Object.prototype).not.toHaveProperty('polluted');
});
it('discovers only allowlisted chat files and skips unsupported session formats', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skilldna-discovery-'));
  try {
    const workspace = join(root, 'a'.repeat(32));
    const chats = join(workspace, 'chatSessions');
    await mkdir(chats, { recursive: true });
    await writeFile(
      join(workspace, 'workspace.json'),
      JSON.stringify({ folder: 'file:///private-workspace' }),
    );
    const session = JSON.stringify({ requests: [{ message: { text: 'identify root cause' } }] });
    await writeFile(join(chats, 'session.json'), session);
    await writeFile(
      join(chats, 'session.jsonl'),
      JSON.stringify({ kind: 0, v: JSON.parse(session) }),
    );
    await writeFile(join(chats, 'unsupported.jsonl'), '{"kind":2,"v":{}}');
    await writeFile(join(chats, 'cache.txt'), session);
    for (const folder of ['chatEditingSessions', 'extensionState', 'unrelated']) {
      await mkdir(join(workspace, folder));
      await writeFile(join(workspace, folder, 'session.json'), session);
    }
    await writeFile(join(workspace, 'state.vscdb'), session);
    const result = await discoverSessions(root, [root]);
    expect(result).toMatchObject({
      foundFiles: 3,
      importedFiles: 1,
      skippedFiles: 2,
      workspaceCount: 1,
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].intent).toBe('identify-root-cause');
    expect(JSON.stringify(result)).not.toContain('private-workspace');
    expect(await readFile(join(chats, 'session.json'), 'utf8')).toBe(session);
    expect((await discoverSessions(root, [join(chats, 'session.json')])).events).toHaveLength(1);
    await expect(discoverSessions(root, [join(workspace, 'state.vscdb')])).rejects.toThrow(
      'Select the discovery root',
    );
    await expect(discoverSessions(root, [tmpdir()])).rejects.toThrow('outside');
    await symlink(chats, join(root, 'b'.repeat(32)), 'junction');
    await expect(discoverSessions(root, [join(root, 'b'.repeat(32))])).rejects.toThrow('Linked');
    const external = join(root, 'external');
    await mkdir(external);
    await writeFile(join(external, 'session.json'), session);
    const linkedWorkspace = join(root, 'c'.repeat(32));
    await mkdir(linkedWorkspace);
    await symlink(external, join(linkedWorkspace, 'chatSessions'), 'junction');
    expect((await discoverSessions(root, [linkedWorkspace])).foundFiles).toBe(0);
    await expect(
      discoverSessions(root, [join(linkedWorkspace, 'chatSessions', 'session.json')]),
    ).rejects.toThrow('Linked');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('imports versioned JSON with opaque identifiers and no raw text', async () => {
  const source = new ImportSource(
    JSON.stringify({
      schemaVersion: 1,
      sessions: [
        {
          id: 'customer-private',
          messages: [{ prompt: 'root cause password=hidden user@example.com' }],
        },
      ],
    }),
    false,
    'batch',
  );
  const events = await source.read();
  expect(events[0].intent).toBe('identify-root-cause');
  expect(JSON.stringify(events)).not.toMatch(/customer-private|hidden|user@example/);
});
it('skips oversized files and nested directories and rejects invalid discovery roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skilldna-discovery-limit-'));
  try {
    const chats = join(root, 'd'.repeat(32), 'chatSessions');
    await mkdir(join(chats, 'nested'), { recursive: true });
    await writeFile(join(chats, 'large.json'), ' '.repeat(5_000_001));
    await writeFile(join(chats, 'nested', 'hidden.json'), '{"events":[{"action":"review"}]}');
    const result = await discoverSessions(root, [root]);
    expect(result).toMatchObject({ foundFiles: 1, importedFiles: 0, skippedFiles: 1, events: [] });
    await expect(discoverSessions(root, [join(chats, 'nested')])).rejects.toThrow(
      'Select the discovery root',
    );
    await expect(discoverSessions(join(root, 'missing'), [root])).rejects.toThrow('unavailable');
    await expect(discoverSessions(root, [])).rejects.toThrow('between 1 and 500');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('imports JSONL grouped by conversation', async () => {
  const events = await new ImportSource(
    '{"conversationId":"private","action":"review"}\n{"conversationId":"private","action":"search"}',
    true,
  ).read();
  expect(events[0].sessionId).toBe(events[1].sessionId);
});
it('reads only the requested sample and reports files left unread', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skilldna-sample-'));
  try {
    const chats = join(root, 'e'.repeat(32), 'chatSessions');
    await mkdir(chats, { recursive: true });
    await writeFile(
      join(chats, 'a.jsonl'),
      JSON.stringify({ kind: 0, v: { requests: [{ message: { text: 'identify root cause' } }] } }),
    );
    await writeFile(join(chats, 'b.jsonl'), 'invalid JSON that must not be parsed');
    const result = await discoverSessions(root, [chats], 1);
    expect(result).toMatchObject({
      foundFiles: 2,
      importedFiles: 1,
      skippedFiles: 0,
      filesNotRead: 1,
    });
    expect(result.events).toHaveLength(1);
    await expect(discoverSessions(root, [chats], 0)).rejects.toThrow('sample size');
    await Promise.all(
      Array.from({ length: 501 }, (_, index) =>
        writeFile(join(chats, `z-${index}.jsonl`), 'invalid unselected content'),
      ),
    );
    expect(await discoverSessions(root, [chats], 1)).toMatchObject({
      foundFiles: 503,
      importedFiles: 1,
      skippedFiles: 0,
      filesNotRead: 502,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it.each([
  'bad json',
  '{"schemaVersion":2,"events":[]}',
  '[{"unexpected":"field"}]',
  '{"events":"bad"}',
])('rejects malformed input without echoing it', async (value) => {
  await expect(new ImportSource(value).read()).rejects.toThrow();
});
