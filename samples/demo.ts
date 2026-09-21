import type { Action, Intent, InteractionSource, WorkflowEvent } from '../packages/domain';
import { normalize } from '../packages/privacy';
import { segment } from '../packages/workflow-engine/sessions';
const support: Intent[] = [
  'review-issue-context',
  'analyze-diagnostic-data',
  'extract-error-signature',
  'identify-changes',
  'search-evidence',
  'identify-root-cause',
  'identify-missing-evidence',
  'generate-rca',
  'draft-customer-update',
];
const developer: Intent[] = [
  'review-failing-test',
  'identify-changes',
  'extract-error-signature',
  'search-evidence',
  'resolve-test-failure',
  'run-tests',
  'update-documentation',
  'generate-pull-request-summary',
];
const incident: Intent[] = [
  'review-alert',
  'analyze-diagnostic-data',
  'establish-impact',
  'identify-component',
  'gather-evidence',
  'plan-mitigation',
  'stakeholder-update',
  'produce-incident-summary',
];
export function actionFor(intent: Intent): Action {
  if (/^review/.test(intent)) return 'review';
  if (/validate|run-tests/.test(intent)) return 'validate';
  if (/compare/.test(intent)) return 'compare';
  if (/search/.test(intent)) return 'search';
  if (/update-documentation/.test(intent)) return 'document';
  if (/resolve/.test(intent)) return 'edit';
  if (/escalation/.test(intent)) return 'escalate';
  if (/update/.test(intent)) return 'communicate';
  if (/generate|produce|plan/.test(intent)) return 'generate';
  if (intent === 'unknown') return 'unknown';
  return 'analyze';
}
export class DemoSource implements InteractionSource {
  readonly type = 'demo' as const;
  async read() {
    return demoEvents();
  }
}
export function demoEvents(): WorkflowEvent[] {
  const events: WorkflowEvent[] = [];
  for (const [family, base, count] of [
    ['support', support, 12],
    ['developer', developer, 7],
    ['incident', incident, 6],
  ] as const) {
    for (let index = 0; index < count; index++) {
      let sequence = [...base];
      if (family === 'support') {
        sequence.splice(4, 0, index % 2 ? 'compare-configuration' : 'validate-authentication');
        if (index % 3 === 0) sequence.splice(sequence.length - 1, 0, 'prepare-escalation');
        if (index === 10)
          sequence = sequence.slice(0, sequence.indexOf('identify-missing-evidence') + 1);
        if (index === 11) sequence = sequence.filter((step) => step !== 'generate-rca');
      }
      if (family === 'developer' && index % 3 === 0)
        sequence = sequence.filter((step) => step !== 'update-documentation');
      if (family === 'incident' && index % 2 === 0) sequence.splice(5, 0, 'search-evidence');
      if (index % 2 === 0) sequence.splice(2, 0, 'unknown', sequence[1]);
      sequence.forEach((intent, step) =>
        events.push(
          normalize(
            {
              intent,
              action: actionFor(intent),
              resource: intent.includes('test')
                ? 'test'
                : intent.includes('configuration')
                  ? 'configuration'
                  : 'log',
              tool: intent.includes('search')
                ? 'search'
                : intent.includes('test')
                  ? 'task'
                  : 'chat',
              outcome:
                index === 10 && family === 'support' && step === sequence.length - 1
                  ? 'blocked'
                  : 'success',
              durationMs: 90_000,
              timestamp: new Date(
                Date.UTC(
                  2026,
                  8,
                  1 + index,
                  family === 'support' ? 9 : family === 'developer' ? 12 : 15,
                  step * 2,
                ),
              ).toISOString(),
              ...(index === 0 && step === 0
                ? {
                    text: 'Synthetic example: analyst@example.invalid password=synthetic-only tenant-id=demo-org C:\\Synthetic\\logs.txt',
                  }
                : {}),
            },
            {
              source: 'demo',
              mode: 'demo-only',
              sessionId: `synthetic-${family}-${index}`,
              id: `demo-${family}-${index}-${step}`,
            },
          ),
        ),
      );
    }
  }
  return events;
}
export const demoSessions = () =>
  segment(demoEvents().map((event) => ({ event }))).map((session) => ({
    ...session,
    approved: true,
  }));
