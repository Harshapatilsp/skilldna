export const actions = [
  'inspect',
  'search',
  'analyze',
  'compare',
  'edit',
  'generate',
  'validate',
  'execute',
  'summarize',
  'communicate',
  'escalate',
  'document',
  'review',
  'approve',
  'export',
  'unknown',
] as const;
export type Action = (typeof actions)[number];
export const intents = [
  'review-issue-context',
  'analyze-diagnostic-data',
  'extract-error-signature',
  'identify-changes',
  'validate-authentication',
  'compare-configuration',
  'search-evidence',
  'identify-root-cause',
  'identify-missing-evidence',
  'generate-rca',
  'prepare-escalation',
  'draft-customer-update',
  'review-failing-test',
  'resolve-test-failure',
  'run-tests',
  'update-documentation',
  'generate-pull-request-summary',
  'review-alert',
  'establish-impact',
  'identify-component',
  'gather-evidence',
  'plan-mitigation',
  'stakeholder-update',
  'produce-incident-summary',
  'unknown',
] as const;
export type Intent = (typeof intents)[number];
export const resources = [
  'source-code',
  'log',
  'configuration',
  'markdown',
  'test',
  'project-file',
  'unknown',
] as const;
export type Resource = (typeof resources)[number];
export type Source = 'demo' | 'import' | 'skilldna' | 'metadata';
export type ConsentMode =
  'off' | 'demo-only' | 'metadata-only' | 'skilldna-interactions' | 'user-imported-content';
export interface Versioned {
  schemaVersion: 1;
}
export interface Classification {
  intent: Intent;
  confidence: number;
  method: 'rule' | 'keyword' | 'user' | 'unknown';
  evidence: 'metadata' | 'redacted-content' | 'user-correction';
  contentRequired: boolean;
}
export interface WorkflowEvent extends Versioned {
  id: string;
  sessionId: string;
  timestamp: string;
  source: Source;
  action: Action;
  intent: Intent;
  suggestedAction?: { action: Action; basis: Intent };
  resource: Resource;
  tool: 'editor' | 'search' | 'terminal' | 'chat' | 'task' | 'debug' | 'unknown';
  outcome: 'success' | 'failure' | 'blocked' | 'unknown';
  confidence: number;
  durationMs?: number;
  consent: ConsentMode;
  redaction: {
    status: 'clean' | 'redacted';
    categories: string[];
    bodiesRemoved: boolean;
  };
  classification: Classification;
  predecessorId?: string;
  parentId?: string;
  feedback?: FeedbackValue;
}
export interface Session extends Versioned {
  id: string;
  source: Source;
  events: WorkflowEvent[];
  reason: string;
  approved: boolean;
  synthetic: boolean;
  createdAt: string;
}
export const feedbackValues = [
  'Useful',
  'Not useful',
  'Already automated',
  'Too sensitive',
  'Not repeatable',
  'Missing steps',
  'Wrong workflow grouping',
] as const;
export type FeedbackValue = (typeof feedbackValues)[number];
export interface Feedback extends Versioned {
  candidateId: string;
  value: FeedbackValue;
  timestamp: string;
}
export interface Step {
  intent: Intent;
  action: Action;
  rate: number;
  confidence: number;
  stable: boolean;
  sources: Source[];
  preceding: Intent[];
  following: Intent[];
}
export type Recommendation =
  | 'Create skill'
  | 'Create prompt template'
  | 'Create agent'
  | 'Create automation or tool'
  | 'Keep manual'
  | 'Need more evidence';
export interface Scores {
  repetition: number;
  stability: number;
  effort: number;
  contextSwitches: number;
  standardization: number;
  outputConsistency: number;
  validation: number;
  privacyRisk: number;
  destructiveRisk: number;
  humanJudgment: number;
  feedback: number;
  intentConfidence: number;
  metadataCompleteness?: number;
}
export interface Candidate extends Versioned {
  combinedFrom?: string[];
  id: string;
  name: string;
  sessionIds: string[];
  occurrences: number;
  steps: Step[];
  entries: Intent[];
  exits: Intent[];
  inputs: string[];
  outputs: string[];
  scores: Scores;
  suitability: number;
  recommendation: Recommendation;
  explanation: string[];
  examples: WorkflowEvent[][];
  frequentSequences: { intents: Intent[]; support: number }[];
  algorithmVersion: string;
}
export interface Draft extends Versioned {
  id: string;
  candidateId: string;
  name: string;
  files: Record<string, string>;
  generatedAt: string;
  status: 'review' | 'approved' | 'rejected' | 'later' | 'exported';
}
export interface Validation {
  errors: string[];
  warnings: string[];
  recommendations: string[];
}
export interface Consent extends Versioned {
  mode: ConsentMode;
  paused: boolean;
}
export interface Settings extends Versioned {
  idleMinutes: number;
  retentionDays: number;
}
export type AuditAction =
  | 'consent-changed'
  | 'import-started'
  | 'import-completed'
  | 'analysis'
  | 'draft-generated'
  | 'validation'
  | 'skill-exported'
  | 'data-deleted';
export interface State extends Versioned {
  settings: Settings;
  consent: Consent;
  sessions: Session[];
  candidates: Candidate[];
  drafts: Draft[];
  feedback: Feedback[];
  audit: (Versioned & { action: AuditAction; timestamp: string })[];
}
export const emptyState = (): State => ({
  schemaVersion: 1,
  settings: { schemaVersion: 1, idleMinutes: 30, retentionDays: 30 },
  consent: { schemaVersion: 1, mode: 'off', paused: true },
  sessions: [],
  candidates: [],
  drafts: [],
  feedback: [],
  audit: [],
});
export interface InteractionSource {
  readonly type: Source;
  read(): Promise<WorkflowEvent[]>;
}
export const label = (value: string) => value.replaceAll('-', ' ');
