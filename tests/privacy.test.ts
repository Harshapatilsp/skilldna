import { describe, expect, it } from 'vitest';
import { classify, normalize, redact, intentActions } from '../packages/privacy';
import { intents } from '../packages/domain';
import { segment } from '../packages/workflow-engine/sessions';
import { demoSessions } from '../samples/demo';
const context = {
  source: 'import' as const,
  mode: 'user-imported-content' as const,
  sessionId: 'opaque',
  id: 'event',
  timestamp: '2026-09-01T00:00:00Z',
};
describe('privacy', () => {
  it('has an action suggestion for every recognized intent', () => {
    expect(Object.keys(intentActions).sort()).toEqual(
      intents.filter((intent) => intent !== 'unknown').sort(),
    );
  });
  it.each([
    ['Review this ticket', 'review'],
    ['Inspect the stack trace', 'analyze'],
    ['Rerun the tests', 'validate'],
    ['What changed in this commit?', 'compare'],
    ['Gather the evidence', 'inspect'],
  ])('suggests an action for %s without inventing recorded facts', (text, action) => {
    const event = normalize({ text }, context);
    expect(event.suggestedAction?.action).toBe(action);
    expect(event.action).toBe('unknown');
    expect(event.outcome).toBe('unknown');
    expect(JSON.stringify(event)).not.toContain(text);
  });
  it('does not override explicit actions or suggest actions for unrecognized content', () => {
    expect(
      normalize({ action: 'inspect', text: 'root cause' }, context).suggestedAction,
    ).toBeUndefined();
    expect(normalize({ text: 'hello' }, context).suggestedAction).toBeUndefined();
  });
  it.each([
    'user@example.com',
    'password=hidden',
    'token: hidden',
    'Server=db;Password=hidden',
    '-----BEGIN PRIVATE KEY-----\nhidden\n-----END PRIVATE KEY-----',
    'C:\\Users\\someone\\file.txt',
    '/home/someone/file',
    'customer-id=contoso',
    'Bearer abc123token',
  ])('redacts %s', (value) => {
    expect(redact(value).text).not.toContain(value);
    expect(redact(value).categories.length).toBeGreaterThan(0);
  });
  it('preserves ordinary technical language', () =>
    expect(redact('Validate authentication and inspect diagnostic logs.').categories).toEqual([]));
  it('normalizes missing and unknown fields without raw content', () => {
    const event = normalize(
      { action: 'mystery', prompt: 'user@example.com', customer: 'never-save' },
      context,
    );
    expect(event.action).toBe('unknown');
    expect(event.schemaVersion).toBe(1);
    expect(event.redaction.categories).toContain('email');
    expect(JSON.stringify(event)).not.toContain('never-save');
    expect(event).not.toHaveProperty('prompt');
  });
  it('rejects unapproved source and unsupported version', () => {
    expect(() => normalize({}, { ...context, mode: 'off' })).toThrow();
    expect(() => normalize({ schemaVersion: 2 }, context)).toThrow();
  });
  it('classifies without content and supports correction', () => {
    expect(classify('inspect', 'log')).toMatchObject({
      method: 'rule',
      contentRequired: false,
    });
    expect(classify('unknown', 'unknown').intent).toBe('unknown');
    expect(classify('unknown', 'unknown', '', 'run-tests')).toMatchObject({
      method: 'user',
      confidence: 1,
    });
  });
  it('uses content only for approved imports', () => {
    expect(normalize({ text: 'root cause' }, context).intent).toBe('identify-root-cause');
    expect(
      normalize({ text: 'root cause' }, { ...context, source: 'metadata', mode: 'metadata-only' })
        .intent,
    ).toBe('unknown');
  });
  it.each(['idle', 'workspace', 'explicit', 'conversation', 'task'])('segments %s', (boundary) => {
    const first = normalize({}, context);
    const second = {
      ...first,
      id: 'second',
      timestamp: boundary === 'idle' ? '2026-09-01T01:00:00Z' : '2026-09-01T00:01:00Z',
      sessionId: boundary === 'conversation' ? 'other' : first.sessionId,
    };
    expect(
      segment([
        { event: first },
        {
          event: second,
          workspace: boundary === 'workspace' ? 'opaque-workspace' : undefined,
          explicitStart: boundary === 'explicit',
          taskBoundary: boundary === 'task',
        },
      ]),
    ).toHaveLength(2);
  });
  it('supports override grouping', () => {
    const event = normalize({}, context);
    expect(
      segment([
        { event, override: 'one' },
        {
          event: { ...event, id: 'second', sessionId: 'other' },
          override: 'one',
        },
      ]),
    ).toHaveLength(1);
  });
  it('ships three synthetic families', () => {
    expect(demoSessions()).toHaveLength(25);
    expect(demoSessions().every((session) => session.synthetic)).toBe(true);
  });
});
