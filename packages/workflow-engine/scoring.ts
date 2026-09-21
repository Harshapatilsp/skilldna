import type { Candidate, Feedback, Recommendation, Scores, Session, Step } from '../domain';
const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
export function score(sessions: Session[], steps: Step[], feedback: Feedback[]): Scores {
  const events = sessions.flatMap((session) => session.events);
  const latest = feedback.at(-1)?.value;
  return {
    metadataCompleteness: events.length
      ? (100 *
          events.filter((event) => event.action !== 'unknown' && event.outcome !== 'unknown')
            .length) /
        events.length
      : 0,
    repetition: Math.min(100, sessions.length * 10),
    stability: Math.round(mean(steps.map((step) => step.rate)) * 100),
    effort: Math.min(
      100,
      Math.round(
        mean(
          sessions.map((session) =>
            session.events.reduce((total, event) => total + (event.durationMs ?? 30_000), 0),
          ),
        ) / 12_000,
      ),
    ),
    contextSwitches: Math.min(
      100,
      mean(
        sessions.map(
          (session) =>
            session.events.filter(
              (event, index) => index > 0 && event.tool !== session.events[index - 1].tool,
            ).length,
        ),
      ) * 20,
    ),
    standardization: Math.round(
      (100 * steps.filter((step) => step.stable).length) / (steps.length || 1),
    ),
    outputConsistency: Math.round(
      (100 *
        sessions.filter(
          (session) =>
            session.events.some((event) =>
              ['generate', 'summarize', 'communicate', 'document'].includes(event.action),
            ) && session.events.at(-1)?.outcome !== 'blocked',
        ).length) /
        (sessions.length || 1),
    ),
    validation: Math.round(
      (100 *
        sessions.filter((session) =>
          session.events.some(
            (event) =>
              event.action === 'validate' ||
              event.action === 'compare' ||
              event.intent === 'gather-evidence',
          ),
        ).length) /
        (sessions.length || 1),
    ),
    privacyRisk:
      latest === 'Too sensitive'
        ? 100
        : Math.round(
            (100 *
              events.filter(
                (event) => event.source !== 'demo' && event.redaction.status === 'redacted',
              ).length) /
              (events.length || 1),
          ),
    destructiveRisk: events.some((event) => event.action === 'execute')
      ? 70
      : events.some((event) => event.action === 'edit')
        ? 25
        : 0,
    humanJudgment: Math.round(
      (100 *
        events.filter((event) =>
          [
            'identify-root-cause',
            'plan-mitigation',
            'establish-impact',
            'prepare-escalation',
          ].includes(event.intent),
        ).length) /
        (events.length || 1),
    ),
    feedback: latest === 'Useful' ? 100 : latest ? 0 : 50,
    intentConfidence: Math.round(mean(events.map((event) => event.confidence)) * 100),
  };
}
export function recommend(
  scores: Scores,
  count: number,
  steps: number,
): {
  recommendation: Recommendation;
  suitability: number;
  explanation: string[];
} {
  const suitability = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        scores.repetition * 0.15 +
          scores.stability * 0.2 +
          scores.effort * 0.1 +
          scores.contextSwitches * 0.05 +
          scores.standardization * 0.1 +
          scores.outputConsistency * 0.1 +
          scores.validation * 0.1 +
          scores.intentConfidence * 0.05 +
          scores.feedback * 0.05 -
          scores.privacyRisk * 0.25 -
          scores.destructiveRisk * 0.2 -
          scores.humanJudgment * 0.1,
      ),
    ),
  );
  let recommendation: Recommendation;
  let reason: string;
  if (scores.privacyRisk >= 60 || scores.destructiveRisk >= 60 || scores.humanJudgment >= 70) {
    recommendation = 'Keep manual';
    reason = 'Privacy, destructive-action, or judgment risk requires human control.';
  } else if ((scores.metadataCompleteness ?? 0) < 100) {
    recommendation = 'Need more evidence';
    reason =
      'Recorded action or outcome evidence is incomplete. Missing metadata is not evidence of low risk. Review the source evidence before recommending automation or a skill.';
  } else if (count < 3 || scores.intentConfidence < 45) {
    recommendation = 'Need more evidence';
    reason = 'Fewer than three independent sessions or low intent confidence.';
  } else if (scores.stability < 45 || scores.feedback === 0) {
    recommendation = 'Keep manual';
    reason = 'The observed path is unstable or local feedback asks for review.';
  } else if (steps <= 2) {
    recommendation = 'Create prompt template';
    reason =
      'A short content transformation needs formatting consistency, not a multi-step procedure.';
  } else if (scores.standardization < 60 && scores.contextSwitches >= 50) {
    recommendation = 'Create agent';
    reason =
      'Substantial branching and tool switching may benefit from iterative planning and state.';
  } else if (
    scores.validation === 100 &&
    scores.humanJudgment === 0 &&
    scores.outputConsistency < 30
  ) {
    recommendation = 'Create automation or tool';
    reason = 'Deterministic validation is better implemented as a reviewed tool.';
  } else {
    recommendation = 'Create skill';
    reason =
      'A repeated, mostly stable multi-step procedure with recognizable outputs is more appropriate than a one-step prompt. Keep approval at sensitive checkpoints.';
  }
  return {
    recommendation,
    suitability,
    explanation: [
      `${count} distinct approved sessions; ${scores.stability}% mean step occurrence.`,
      reason,
      'Scores are transparent heuristics, not calibrated probabilities or employee assessments. Risk estimates are lower bounds; review is required.',
    ],
  };
}
export function rerank(candidate: Candidate, feedback: Feedback[]): Candidate {
  const sessions = candidate.examples.map((events, index): Session => ({
    schemaVersion: 1,
    id: String(index),
    events,
    source: events[0]?.source ?? 'demo',
    approved: true,
    synthetic: events[0]?.source === 'demo',
    createdAt: events[0]?.timestamp ?? '',
    reason: 'Representative example',
  }));
  const updated = score(
    sessions,
    candidate.steps,
    feedback.filter((item) => item.candidateId === candidate.id),
  );
  const scores = {
    ...candidate.scores,
    feedback: updated.feedback,
    privacyRisk: Math.max(candidate.scores.privacyRisk, updated.privacyRisk),
  };
  const ranking = recommend(scores, candidate.occurrences, candidate.steps.length);
  return {
    ...candidate,
    scores,
    ...ranking,
    ...(candidate.combinedFrom
      ? {
          recommendation:
            ranking.recommendation === 'Keep manual'
              ? ('Keep manual' as const)
              : ('Need more evidence' as const),
          explanation: candidate.explanation,
        }
      : {}),
  };
}
