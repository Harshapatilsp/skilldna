import { describe, expect, it } from 'vitest';
import { demoSessions } from '../samples/demo';
import { clean, defaults, frequent, SequenceMiner } from '../packages/workflow-engine';
import { recommend, rerank } from '../packages/workflow-engine/scoring';
import type { Intent } from '../packages/domain';
import {
  CopilotReviewQueue,
  parseAssessment,
  reviewSummary,
} from '../packages/workflow-engine/copilot-review';
const candidates = new SequenceMiner().mine(demoSessions());
describe('Copilot review boundary', () => {
  const response = JSON.stringify({
    recommendation: 'Need more evidence',
    rationale: 'Review outcomes.',
    missingEvidence: ['Confirmed outcomes'],
    risks: [],
  });
  it('requires opt-in, reuses unchanged results, and reviews changed evidence again', async () => {
    const queue = new CopilotReviewQueue(() => {});
    let calls = 0;
    const review = async () => {
      calls++;
      return response;
    };
    await queue.schedule(candidates, demoSessions());
    expect(calls).toBe(0);
    queue.enable('Test model', review);
    await queue.schedule(candidates, demoSessions());
    expect(calls).toBe(candidates.length);
    await queue.schedule(candidates, demoSessions());
    expect(calls).toBe(candidates.length);
    await queue.schedule(
      candidates.map((candidate) => ({ ...candidate, recommendation: 'Keep manual' })),
      demoSessions(),
    );
    expect(calls).toBe(candidates.length * 2);
    queue.disable();
    expect(queue.state.reviews).toEqual({});
    await queue.schedule(candidates, demoSessions());
    expect(calls).toBe(candidates.length * 2);
  });
  it('discards late responses after consent revocation or deletion', async () => {
    const queue = new CopilotReviewQueue(() => {});
    let finish: (text: string) => void = () => {};
    let signal: AbortSignal | undefined;
    queue.enable('Test model', (_, requestSignal) => {
      signal = requestSignal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const pending = queue.schedule(candidates, demoSessions());
    queue.disable();
    expect(signal?.aborted).toBe(true);
    finish(response);
    await pending;
    expect(queue.state.reviews).toEqual({});
  });
  it('stops on unavailable or invalid responses without affecting local results', async () => {
    const queue = new CopilotReviewQueue(() => {});
    let calls = 0;
    queue.enable('Test model', async () => {
      calls++;
      throw new Error('Private provider error');
    });
    await queue.schedule(candidates, demoSessions());
    expect(calls).toBe(1);
    expect(
      Object.values(queue.state.reviews).every((review) => review.status === 'unavailable'),
    ).toBe(true);
    expect(queue.state.notice).not.toContain('Private provider error');
    expect(candidates[0].recommendation).toBe('Create skill');
  });
  it('times out a stalled model without blocking local work', async () => {
    const queue = new CopilotReviewQueue(() => {}, 5);
    queue.enable('Test model', () => new Promise(() => {}));
    await queue.schedule(candidates, demoSessions());
    expect(queue.state.reviews[candidates[0].id].status).toBe('unavailable');
  });
  it('caps reviews at ten candidates and clears cached results when evidence is removed', async () => {
    const queue = new CopilotReviewQueue(() => {});
    let calls = 0;
    queue.enable('Test model', async () => {
      calls++;
      return response;
    });
    const many = Array.from({ length: 12 }, (_, index) => ({
      ...candidates[0],
      id: `candidate-${index}`,
    }));
    await queue.schedule(many, demoSessions());
    expect(calls).toBe(10);
    queue.clear();
    expect(queue.state.reviews).toEqual({});
    await queue.schedule([many[0]], demoSessions());
    expect(calls).toBe(11);
    await queue.schedule([], demoSessions());
    await queue.schedule([many[0]], demoSessions());
    expect(calls).toBe(12);
  });
  it('ignores an older analysis that finishes after a newer one', async () => {
    const queue = new CopilotReviewQueue(() => {});
    let finish: (text: string) => void = () => {};
    let calls = 0;
    queue.enable('Test model', () => {
      calls++;
      return calls === 1
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(response);
    });
    const first = queue.schedule([candidates[0]], demoSessions());
    await queue.schedule([candidates[1]], demoSessions());
    finish(response);
    await first;
    expect(Object.keys(queue.state.reviews)).toEqual([candidates[1].id]);
    expect(queue.state.reviews[candidates[1].id].status).toBe('complete');
  });
  it('sends only approved categorical evidence, never names, paths, bodies or identifiers', () => {
    const sessions = demoSessions();
    const candidate = { ...candidates[0], name: 'SECRET-NAME', inputs: ['SECRET-PATH'] };
    const summary = reviewSummary(candidate, sessions)!;
    const serialized = JSON.stringify(summary);
    expect(summary.independentSessions).toBe(candidate.sessionIds.length);
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain(candidate.id);
    expect(serialized).not.toContain(candidate.sessionIds[0]);
    expect(
      reviewSummary(
        candidate,
        sessions.map((session) => ({ ...session, approved: false })),
      ),
    ).toBeUndefined();
    expect(reviewSummary(candidate, [])).toBeUndefined();
  });
  it('keeps unknown evidence and local recommendations independent of model opinions', () => {
    const sessions = demoSessions().map((session) => ({
      ...session,
      events: session.events.map((event) => ({ ...event, outcome: 'unknown' as const })),
    }));
    const candidate = new SequenceMiner().mine(sessions)[0];
    const summary = reviewSummary(candidate, sessions)!;
    const assessment = parseAssessment(
      JSON.stringify({
        recommendation: 'Create skill',
        rationale: 'Potentially reusable.',
        missingEvidence: [],
        risks: [],
      }),
    );
    expect(summary.outcomes.unknown).toBeGreaterThan(0);
    expect(candidate.recommendation).toBe('Need more evidence');
    expect(assessment.recommendation).toBe('Create skill');
  });
  it('rejects malformed, oversized and unexpected model output', () => {
    expect(() => parseAssessment('```json\n{}\n```')).toThrow();
    expect(() => parseAssessment('x'.repeat(8001))).toThrow();
    expect(() =>
      parseAssessment(JSON.stringify({ recommendation: 'Run shell', rationale: 'Do it' })),
    ).toThrow();
    expect(() =>
      parseAssessment(
        JSON.stringify({
          recommendation: 'Create skill',
          rationale: 'OK',
          missingEvidence: [],
          risks: [],
          command: 'execute',
        }),
      ),
    ).toThrow();
  });
});
function relatedSessions() {
  const base = demoSessions()[0];
  const core: Intent[] = [
    'review-issue-context',
    'analyze-diagnostic-data',
    'identify-changes',
    'generate-rca',
  ];
  const branches: Intent[][] = [
    [
      'search-evidence',
      'compare-configuration',
      'validate-authentication',
      'draft-customer-update',
    ],
    ['review-failing-test', 'resolve-test-failure', 'run-tests', 'update-documentation'],
  ];
  return branches.flatMap((branch, variant) =>
    Array.from({ length: 3 }, (_, index) => ({
      ...base,
      id: `variant-${variant}-${index}`,
      events: [...core, ...branch].map((intent, eventIndex) => ({
        ...base.events[0],
        id: `event-${variant}-${index}-${eventIndex}`,
        intent,
        action: 'inspect' as const,
        outcome: 'success' as const,
      })),
    })),
  );
}
describe('workflow intelligence', () => {
  it('proposes related variants without fabricating combined execution support', () => {
    const sessions = relatedSessions();
    const results = new SequenceMiner().mine(sessions);
    const combined = results.find((candidate) => candidate.combinedFrom)!;
    expect(results).toHaveLength(3);
    expect(combined.combinedFrom).toHaveLength(2);
    expect(combined.examples).toHaveLength(2);
    expect(combined.examples[0].map((event) => event.intent)).not.toEqual(
      combined.examples[1].map((event) => event.intent),
    );
    expect(combined.sessionIds).toHaveLength(6);
    expect(new Set(combined.sessionIds).size).toBe(6);
    expect(combined.steps.filter((step) => step.stable)).toHaveLength(4);
    expect(combined.steps.filter((step) => !step.stable)).toHaveLength(8);
    expect(combined.recommendation).toBe('Need more evidence');
    expect(combined.explanation.join(' ')).toContain(
      'not executions of a combined end-to-end procedure',
    );
    expect(
      new SequenceMiner().mine([...sessions].reverse()).find((candidate) => candidate.combinedFrom)
        ?.id,
    ).toBe(combined.id);
    expect(
      rerank(combined, [
        { schemaVersion: 1, candidateId: combined.id, value: 'Useful', timestamp: '' },
      ]).recommendation,
    ).toBe('Need more evidence');
  });
  it('does not combine variants across sources or conflicting core order', () => {
    const sessions = relatedSessions();
    expect(
      new SequenceMiner()
        .mine(
          sessions.map((session, index) =>
            index < 3 ? session : { ...session, source: 'import' as const, synthetic: false },
          ),
        )
        .some((candidate) => candidate.combinedFrom),
    ).toBe(false);
    expect(
      new SequenceMiner()
        .mine(
          sessions.map((session, index) =>
            index < 3
              ? session
              : {
                  ...session,
                  events: [...session.events.slice(0, 4).reverse(), ...session.events.slice(4)],
                },
          ),
        )
        .some((candidate) => candidate.combinedFrom),
    ).toBe(false);
    expect(
      new SequenceMiner().mine(sessions.slice(1)).some((candidate) => candidate.combinedFrom),
    ).toBe(false);
  });
  it('does not require optional resource categories', () => {
    const sessions = demoSessions().map((session) => ({
      ...session,
      events: session.events.map((event) => ({ ...event, resource: 'unknown' as const })),
    }));
    expect(new SequenceMiner().mine(sessions)[0].recommendation).toBe(candidates[0].recommendation);
  });
  it('keeps identical real and demo workflows distinct for selection and generation', () => {
    const demo = demoSessions();
    const imported = demo.map((session) => ({
      ...session,
      id: `import-${session.id}`,
      synthetic: false,
      source: 'import' as const,
      events: session.events.map((event) => ({ ...event, source: 'import' as const })),
    }));
    const results = new SequenceMiner().mine([...demo, ...imported]);
    expect(results).toHaveLength(6);
    expect(new Set(results.map((candidate) => candidate.id)).size).toBe(6);
    expect(results.filter((candidate) => candidate.id.startsWith('workflow-real-'))).toHaveLength(
      3,
    );
    expect(
      results.every(
        (candidate) =>
          candidate.sessionIds.every((id) => id.startsWith('import-')) ||
          candidate.sessionIds.every((id) => !id.startsWith('import-')),
      ),
    ).toBe(true);
  });
  it('clusters three repeated families', () => {
    expect(candidates).toHaveLength(3);
    expect(candidates[0].occurrences).toBe(12);
    expect(candidates[0].recommendation).toBe('Create skill');
  });
  it('keeps observed evidence separate and identifiers deterministic across input ordering', () => {
    const demo = demoSessions()[0];
    const imported = { ...demo, id: 'imported', synthetic: false, source: 'import' as const };
    const observed = { ...demo, id: 'observed', synthetic: false, source: 'metadata' as const };
    const miner = new SequenceMiner();
    const results = miner.mine([imported, observed]);
    expect(results).toHaveLength(2);
    expect(new Set(results.map((candidate) => candidate.id)).size).toBe(2);
    expect(miner.mine([observed, imported]).map((candidate) => candidate.id)).toEqual(
      results.map((candidate) => candidate.id),
    );
    expect(results.every((candidate) => candidate.occurrences === 1)).toBe(true);
  });
  it('distinguishes clusters with the same stable intent set but different sequences', () => {
    const base = demoSessions()[0];
    const first = { ...base, id: 'first', events: clean(base.events).slice(0, 2) };
    const second = {
      ...base,
      id: 'second',
      events: [first.events[1], first.events[0], first.events[1]],
    };
    const results = new SequenceMiner({ ...defaults, similarity: 1 }).mine([first, second]);
    expect(results).toHaveLength(2);
    expect(results[0].steps.map((step) => step.intent)).toEqual(
      results[1].steps.map((step) => step.intent),
    );
    expect(results[0].id).not.toBe(results[1].id);
  });
  it('extracts stable and optional paths', () => {
    const steps = candidates[0].steps;
    expect(steps.find((step) => step.intent === 'review-issue-context')?.stable).toBe(true);
    expect(steps.find((step) => step.intent === 'validate-authentication')?.stable).toBe(false);
    expect(steps.find((step) => step.intent === 'prepare-escalation')?.rate).toBeCloseTo(1 / 3);
  });
  it.each(['action', 'outcome'] as const)(
    'requires evidence when %s metadata is missing',
    (field) => {
      const sessions = demoSessions().map((session) => ({
        ...session,
        events: session.events.map((event) => ({ ...event, [field]: 'unknown' as const })),
      }));
      const result = new SequenceMiner().mine(sessions)[0];
      expect(result.scores.metadataCompleteness).toBe(0);
      expect(result.recommendation).toBe('Need more evidence');
      expect(result.explanation.join(' ')).toContain(
        'Missing metadata is not evidence of low risk',
      );
      expect(
        rerank(result, [
          { schemaVersion: 1, candidateId: result.id, value: 'Useful', timestamp: '' },
        ]).recommendation,
      ).toBe('Need more evidence');
    },
  );
  it('removes noise and collapses adjacent repeats', () => {
    const events = demoSessions()[0].events;
    const result = clean(events);
    expect(result.some((event) => event.intent === 'unknown')).toBe(false);
    expect(result.filter((event) => event.intent === 'analyze-diagnostic-data')).toHaveLength(1);
  });
  it('preserves blocked exit evidence', () =>
    expect(candidates[0].exits).toContain('identify-missing-evidence'));
  it('counts distinct session support and removes redundant subsets', () => {
    const session = {
      ...demoSessions()[0],
      events: clean(demoSessions()[0].events),
    };
    const sequences = frequent([session, session], {
      ...defaults,
      minSupport: 1,
    });
    expect(sequences.every((item) => item.support === 1)).toBe(true);
    expect(sequences.some((item) => item.intents.length === 2)).toBe(false);
  });
  it('ignores unapproved sessions', () =>
    expect(
      new SequenceMiner().mine(demoSessions().map((session) => ({ ...session, approved: false }))),
    ).toEqual([]));
  it.each([
    ['privacyRisk', 90, 'Keep manual'],
    ['destructiveRisk', 90, 'Keep manual'],
    ['humanJudgment', 90, 'Keep manual'],
    ['stability', 20, 'Keep manual'],
    ['intentConfidence', 10, 'Need more evidence'],
  ] as const)('handles %s risk', (key, value, expected) =>
    expect(recommend({ ...candidates[0].scores, [key]: value }, 12, 10).recommendation).toBe(
      expected,
    ),
  );
  it('recommends prompts, agents, tools, or more evidence', () => {
    const scores = candidates[0].scores;
    expect(recommend(scores, 1, 10).recommendation).toBe('Need more evidence');
    expect(recommend(scores, 5, 1).recommendation).toBe('Create prompt template');
    expect(
      recommend({ ...scores, standardization: 40, contextSwitches: 80 }, 5, 10).recommendation,
    ).toBe('Create agent');
    expect(
      recommend({ ...scores, validation: 100, humanJudgment: 0, outputConsistency: 0 }, 5, 5)
        .recommendation,
    ).toBe('Create automation or tool');
  });
  it('uses local feedback without employee ranking', () =>
    expect(
      rerank(candidates[0], [
        {
          schemaVersion: 1,
          candidateId: candidates[0].id,
          value: 'Too sensitive',
          timestamp: '',
        },
      ]).recommendation,
    ).toBe('Keep manual'));
});
