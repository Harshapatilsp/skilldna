import { expect, it } from 'vitest';
import { Application } from '../packages/application';
import { messageSchema } from '../packages/domain/protocol';
import { demoSessions } from '../samples/demo';
import { normalize } from '../packages/privacy';
it('updates action suggestions after corrections without changing recorded actions', () => {
  const app = new Application();
  const event = normalize(
    { text: 'root cause' },
    { source: 'import', mode: 'user-imported-content', sessionId: 'session', id: 'event' },
  );
  app.pending = [{ ...demoSessions()[0], id: 'session', events: [event] }];
  app.handle({ type: 'correct', sessionId: 'session', eventId: 'event', intent: 'run-tests' });
  expect(event.suggestedAction).toEqual({ action: 'validate', basis: 'run-tests' });
  expect(event.action).toBe('unknown');
  app.handle({ type: 'correct', sessionId: 'session', eventId: 'event', intent: 'unknown' });
  expect(event.suggestedAction).toBeUndefined();
});
it('approves selected sessions and discovers workflows without retaining excluded sessions', () => {
  const app = new Application();
  app.pending = demoSessions().map((session) => ({ ...session, approved: false }));
  const selected = app.pending.slice(0, 12).map((session) => session.id);
  expect(app.state.sessions).toEqual([]);
  expect(app.state.candidates).toEqual([]);
  app.handle(messageSchema.parse({ type: 'approveSessions', ids: selected, analyze: true }));
  expect(app.state.sessions.map((session) => session.id)).toEqual(selected);
  expect(app.state.sessions.every((session) => session.approved)).toBe(true);
  expect(app.pending).toEqual([]);
  expect(app.state.candidates.length).toBeGreaterThan(0);
  expect(app.view).toBe('Workflows');
  expect(app.state.consent).toMatchObject({ mode: 'off', paused: true });
});
it('keeps pending sessions when discovery has no valid selection', () => {
  const app = new Application();
  app.pending = demoSessions();
  expect(() => app.handle({ type: 'approveSessions', ids: ['missing'], analyze: true })).toThrow(
    'Select at least one',
  );
  expect(app.pending).toHaveLength(25);
  expect(app.state.sessions).toEqual([]);
  expect(app.state.candidates).toEqual([]);
});
it('discovers the synthetic demo in one action without enabling observation', () => {
  const app = new Application();
  app.handle({ type: 'discoverDemo' });
  expect(app.state.sessions).toHaveLength(25);
  expect(app.state.candidates).toHaveLength(3);
  expect(app.view).toBe('Workflows');
  expect(app.state.consent.paused).toBe(true);
});
it.each(['off', 'demo-only', 'user-imported-content'] as const)(
  '%s does not enable background observation',
  (mode) => {
    const app = new Application();
    app.handle({ type: 'consent', mode });
    expect(app.state.consent.paused).toBe(true);
    expect(app.view).toBe('Privacy');
    expect(() => app.handle({ type: 'resume' })).toThrow('Enable an observation source');
    expect(app.state.consent.paused).toBe(true);
  },
);
it('rejects removed chat collection consent and cannot resume legacy chat collection', () => {
  expect(messageSchema.safeParse({ type: 'consent', mode: 'skilldna-interactions' }).success).toBe(
    false,
  );
  const app = new Application();
  app.state.consent = { schemaVersion: 1, mode: 'skilldna-interactions', paused: true };
  expect(() => app.handle({ type: 'resume' })).toThrow('Enable an observation source');
});
it('deletes all imported sessions while keeping demo candidates and drafts', () => {
  const app = new Application();
  app.handle({ type: 'demo' });
  app.handle({ type: 'analyze' });
  app.handle({ type: 'generate', id: app.state.candidates[0].id });
  const demoDraftId = app.state.drafts[0].candidateId;
  app.state.sessions.push(
    ...demoSessions()
      .slice(0, 3)
      .map((session, index) => ({
        ...session,
        id: `imp-${index}`,
        synthetic: false,
        source: 'import' as const,
        approved: true,
        events: session.events.map((event) => ({ ...event, source: 'import' as const })),
      })),
  );
  app.handle({ type: 'analyze' });
  expect(app.state.sessions.some((session) => session.source === 'import')).toBe(true);
  app.handle(messageSchema.parse({ type: 'deleteImported' }));
  expect(app.state.sessions.some((session) => session.source === 'import')).toBe(false);
  expect(app.state.sessions).toHaveLength(25);
  expect(app.view).toBe('Sessions');
  expect(app.state.candidates.every((candidate) => !candidate.id.startsWith('workflow-real'))).toBe(
    true,
  );
  expect(app.state.drafts.some((draft) => draft.candidateId === demoDraftId)).toBe(true);
  expect(app.notice).toContain('Deleted 3 imported session');
});
it('reports when there are no imported sessions to delete', () => {
  const app = new Application();
  app.handle({ type: 'demo' });
  app.handle({ type: 'deleteImported' });
  expect(app.state.sessions).toHaveLength(25);
  expect(app.notice).toContain('No imported sessions to delete');
});
it.each(['metadata-only'] as const)(
  '%s supports explicit pause and resume without changing consent',
  (mode) => {
    const app = new Application();
    app.handle({ type: 'consent', mode });
    expect(app.state.consent.paused).toBe(false);
    app.handle({ type: 'pause' });
    expect(app.state.consent).toMatchObject({ mode, paused: true });
    app.handle({ type: 'resume' });
    expect(app.state.consent).toMatchObject({ mode, paused: false });
    expect(app.view).toBe('Privacy');
    app.handle({ type: 'consent', mode: 'off' });
    expect(app.state.consent.paused).toBe(true);
  },
);
it('runs the shared demo to draft and validation flow', () => {
  const app = new Application();
  app.handle({ type: 'demo' });
  app.handle({ type: 'analyze' });
  app.handle({ type: 'generate', id: app.state.candidates[0].id });
  app.handle({ type: 'validate', id: app.state.drafts[0].id });
  expect(app.validation?.errors).toEqual([]);
  expect(app.state.consent.paused).toBe(true);
});
it('does not persist pending or invalid draft data', () => {
  const app = new Application();
  app.handle({ type: 'demo' });
  app.pending = [app.state.sessions[0]];
  expect(app.state).not.toHaveProperty('pending');
  app.handle({ type: 'analyze' });
  app.handle({ type: 'generate', id: app.state.candidates[0].id });
  const draft = app.state.drafts[0];
  app.handle({
    type: 'saveDraft',
    id: draft.id,
    name: draft.name,
    files: {
      ...draft.files,
      'SKILL.md': draft.files['SKILL.md'] + '\npassword=hidden',
    },
    status: 'approved',
  });
  expect(app.validation?.errors.length).toBeGreaterThan(0);
  expect(app.state.drafts[0].status).toBe('review');
});
it('validates untrusted messages', () => {
  expect(messageSchema.safeParse({ type: 'runTerminal', command: 'bad' }).success).toBe(false);
  expect(
    messageSchema.safeParse({
      type: 'settings',
      idleMinutes: -1,
      retentionDays: 0,
    }).success,
  ).toBe(false);
});
