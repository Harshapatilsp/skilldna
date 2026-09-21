import {
  label,
  type Candidate,
  type Feedback,
  type Intent,
  type Session,
  type Step,
  type WorkflowEvent,
} from '../domain';
import { recommend, score } from './scoring';
export interface MiningOptions {
  minLength: number;
  maxLength: number;
  minSupport: number;
  similarity: number;
  stableThreshold: number;
  noise: Intent[];
}
export const defaults: MiningOptions = {
  minLength: 2,
  maxLength: 12,
  minSupport: 3,
  similarity: 0.55,
  stableThreshold: 0.8,
  noise: ['unknown'],
};
export function clean(events: WorkflowEvent[], noise: Intent[] = defaults.noise) {
  return events
    .filter((event) => !noise.includes(event.intent))
    .filter(
      (event, index, filtered) =>
        index === 0 ||
        event.intent !== filtered[index - 1].intent ||
        event.action !== filtered[index - 1].action,
    );
}
export function similarity(left: Intent[], right: Intent[]) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  left.forEach((intent, row) => {
    const current = [row + 1];
    right.forEach((other, column) =>
      current.push(
        Math.min(
          current[column] + 1,
          previous[column + 1] + 1,
          previous[column] + (intent === other ? 0 : 1),
        ),
      ),
    );
    previous = current;
  });
  return 1 - previous[right.length] / Math.max(left.length, right.length, 1);
}
export function frequent(sessions: Session[], options: MiningOptions) {
  const support = new Map<string, Set<string>>();
  for (const session of sessions) {
    const sequence = session.events.map((event) => event.intent);
    for (let start = 0; start < sequence.length; start++)
      for (
        let length = options.minLength;
        length <= Math.min(options.maxLength, sequence.length - start);
        length++
      ) {
        const key = sequence.slice(start, start + length).join('|');
        const ids = support.get(key) ?? new Set<string>();
        ids.add(session.id);
        support.set(key, ids);
      }
  }
  const sequences = [...support]
    .filter(([, ids]) => ids.size >= options.minSupport)
    .map(([key, ids]) => ({
      intents: key.split('|') as Intent[],
      support: ids.size,
    }));
  return sequences
    .filter(
      (item) =>
        !sequences.some(
          (other) =>
            other.intents.length > item.intents.length &&
            other.support >= item.support &&
            `|${other.intents.join('|')}|`.includes(`|${item.intents.join('|')}|`),
        ),
    )
    .sort(
      (left, right) => right.support - left.support || right.intents.length - left.intents.length,
    );
}
export interface WorkflowMiner {
  mine(sessions: Session[], feedback?: Feedback[]): Candidate[];
}
export class SequenceMiner implements WorkflowMiner {
  constructor(private readonly options: MiningOptions = defaults) {}
  mine(input: Session[], feedback: Feedback[] = []): Candidate[] {
    const sessions = [
      ...new Map(
        input
          .filter((session) => session.approved)
          .map((session) => [
            session.id,
            { ...session, events: clean(session.events, this.options.noise) },
          ]),
      ).values(),
    ]
      .filter((session) => session.events.length)
      .sort(
        (left, right) =>
          right.events.length - left.events.length || left.id.localeCompare(right.id),
      );
    if (sessions.length > 500 || sessions.some((session) => session.events.length > 200))
      throw new Error(
        'MVP analysis limit: 500 sessions, 200 events per session. Select a smaller batch.',
      );
    const clusters: Session[][] = [];
    for (const session of sessions) {
      const sequence = session.events.map((event) => event.intent);
      const cluster = clusters.find(
        (group) =>
          group[0].synthetic === session.synthetic &&
          group[0].source === session.source &&
          similarity(
            group[0].events.map((event) => event.intent),
            sequence,
          ) >= this.options.similarity,
      );
      if (cluster) cluster.push(session);
      else clusters.push([session]);
    }
    const buildCandidate = (group: Session[]): Candidate => {
      const order: Intent[] = [];
      for (const session of group)
        session.events.forEach((event, index) => {
          if (!order.includes(event.intent)) {
            const next = session.events
              .slice(index + 1)
              .find((item) => order.includes(item.intent));
            if (next) order.splice(order.indexOf(next.intent), 0, event.intent);
            else order.push(event.intent);
          }
        });
      const steps: Step[] = order.map((intent) => {
        const occurrences = group.filter((session) =>
          session.events.some((event) => event.intent === intent),
        );
        const events = occurrences.flatMap((session) =>
          session.events.filter((event) => event.intent === intent),
        );
        const preceding = new Set<Intent>();
        const following = new Set<Intent>();
        for (const session of occurrences)
          session.events.forEach((event, index) => {
            if (event.intent === intent) {
              if (index) preceding.add(session.events[index - 1].intent);
              if (index + 1 < session.events.length)
                following.add(session.events[index + 1].intent);
            }
          });
        return {
          intent,
          action: events[0].action,
          rate: occurrences.length / group.length,
          confidence: events.reduce((sum, event) => sum + event.confidence, 0) / events.length,
          stable: occurrences.length / group.length >= this.options.stableThreshold,
          sources: [...new Set(events.map((event) => event.source))],
          preceding: [...preceding],
          following: [...following],
        };
      });
      const name = order.includes('review-issue-context')
        ? 'Evidence-Based Case Investigation'
        : order.includes('review-failing-test')
          ? 'Developer Failure Investigation'
          : order.includes('review-alert')
            ? 'Incident Response'
            : `${label(order[0])} workflow`;
      const id = `${group[0].synthetic ? 'workflow-demo' : 'workflow-real'}-${group[0].source}-${group[0].events.map((event) => event.intent).join('-')}`;
      const scores = score(
        group,
        steps,
        feedback.filter((item) => item.candidateId === id),
      );
      const candidate: Candidate = {
        schemaVersion: 1,
        id,
        name,
        sessionIds: group.map((session) => session.id),
        occurrences: group.length,
        steps,
        entries: [...new Set(group.map((session) => session.events[0].intent))],
        exits: [...new Set(group.map((session) => session.events.at(-1)!.intent))],
        inputs: [
          'Approved issue or task context',
          'Relevant redacted evidence',
          'Expected outcome and constraints',
        ],
        outputs: [
          ...new Set(
            steps
              .filter((step) =>
                ['generate', 'communicate', 'document', 'summarize'].includes(step.action),
              )
              .map((step) => label(step.intent)),
          ),
        ],
        scores,
        ...recommend(scores, group.length, steps.length),
        examples: group.slice(0, 3).map((session) => session.events),
        frequentSequences: frequent(group, this.options),
        algorithmVersion: 'sequence-edit-v2',
      };
      candidate.explanation.push(
        `Normalized edit similarity >= ${this.options.similarity}; stable threshold ${Math.round(this.options.stableThreshold * 100)}%; ${candidate.frequentSequences.length} maximal frequent contiguous sequences.`,
        `${group.filter((session) => session.events.at(-1)?.outcome === 'blocked').length} sessions ended blocked; no successful outcome is assumed for them.`,
      );
      return candidate;
    };
    const candidates = clusters.map(buildCandidate);
    const combinations: Candidate[] = [];
    const repeated = candidates
      .filter((candidate) => candidate.occurrences >= this.options.minSupport)
      .slice(0, 20);
    for (const [index, left] of repeated.entries()) {
      for (const right of repeated.slice(index + 1)) {
        if (combinations.length >= 10) break;
        const leftSessions = sessions.filter((session) => left.sessionIds.includes(session.id));
        const rightSessions = sessions.filter((session) => right.sessionIds.includes(session.id));
        if (
          leftSessions[0].source !== rightSessions[0].source ||
          leftSessions[0].synthetic !== rightSessions[0].synthetic
        )
          continue;
        const leftCore = left.steps.filter((step) => step.stable).map((step) => step.intent);
        const rightCore = right.steps.filter((step) => step.stable).map((step) => step.intent);
        const shared = leftCore.filter((intent) => rightCore.includes(intent));
        if (
          shared.length < 2 ||
          shared.length / Math.max(leftCore.length, rightCore.length) < 0.5 ||
          !leftCore.some((intent) => !shared.includes(intent)) ||
          !rightCore.some((intent) => !shared.includes(intent))
        )
          continue;
        const evidence = [...leftSessions, ...rightSessions];
        if (
          !evidence.every(
            (session) =>
              session.events
                .filter((event) => shared.includes(event.intent))
                .map((event) => event.intent)
                .join('|') === shared.join('|'),
          )
        )
          continue;
        const combined = buildCandidate(evidence);
        combined.combinedFrom = [left.id, right.id];
        combined.id = `combined-${JSON.stringify(combined.combinedFrom)}`;
        combined.name = `Combined ${label(shared[0])} variants`;
        combined.examples = [left.examples[0], right.examples[0]];
        combined.scores = score(
          evidence,
          combined.steps,
          feedback.filter((item) => item.candidateId === combined.id),
        );
        Object.assign(combined, recommend(combined.scores, evidence.length, combined.steps.length));
        if (combined.recommendation !== 'Keep manual')
          combined.recommendation = 'Need more evidence';
        combined.explanation = [
          `Potential combined skill: ${shared.map(label).join(' -> ')} appears in the same order in every supporting session.`,
          `${left.occurrences} sessions support the first variant and ${right.occurrences} support the second. The ${evidence.length} total is support across variants, not executions of a combined end-to-end procedure.`,
          'Review whether both variants serve the same goal. Branches remain alternatives; their adjacency does not prove an observed transition. Original workflows are retained.',
          'Combination discovery compares at most 20 repeated families and returns at most 10 proposals. It does not infer handoffs between unrelated sessions.',
          ...combined.explanation.filter(
            (text) => !text.includes('more appropriate than a one-step prompt'),
          ),
        ];
        combinations.push(combined);
      }
    }
    return [...candidates, ...combinations].sort(
      (left, right) => right.suitability - left.suitability || right.occurrences - left.occurrences,
    );
  }
}
