import {
  actions,
  intents,
  resources,
  type Action,
  type Classification,
  type ConsentMode,
  type Intent,
  type Resource,
  type Source,
  type WorkflowEvent,
} from '../domain';
const detectors: [string, RegExp][] = [
  [
    'private-key',
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  ],
  ['connection-string', /(?:DefaultEndpointsProtocol|Server|Data Source|AccountName)\s*=[^\n]+/gi],
  [
    'secret',
    /\b(?:password|passwd|pwd|token|secret|api[-_]?key|AccountKey|SharedAccessSignature)\s*[:=]\s*["']?[^\s;"']+/gi,
  ],
  [
    'token',
    /\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
  ],
  ['token', /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi],
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  [
    'identifier',
    /\b(?:customer|tenant|case|subscription)[-_ ]?(?:id|name)?\s*[:=#]\s*["']?[^\s,;"']+/gi,
  ],
  ['identifier', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi],
  ['path', /(?:[A-Za-z]:[\\/]|\\\\)[^\s<>"']+|\/(?:Users|home|var|tmp|etc|mnt|opt)\/[^\s<>"']+/g],
];
export function redact(text: string) {
  const categories: string[] = [];
  let result = text;
  for (const [category, pattern] of detectors) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, () => {
      if (!categories.includes(category)) categories.push(category);
      return `[REDACTED_${category.toUpperCase().replaceAll('-', '_')}]`;
    });
  }
  return { text: result, categories };
}
export function fileCategory(path: string): Resource {
  if (/\.(test|spec)\.|[\\/]tests?[\\/]/i.test(path)) return 'test';
  if (/\.(log|etl|blg|dmp)$/i.test(path)) return 'log';
  if (/\.(json|ya?ml|toml|ini|config|env)$/i.test(path)) return 'configuration';
  if (/\.(md|txt)$/i.test(path)) return 'markdown';
  if (/\.(sln|csproj|gradle)$/i.test(path)) return 'project-file';
  if (/\.(tsx?|jsx?|py|cs|go|rs|java|cpp|c|html|css)$/i.test(path)) return 'source-code';
  return 'unknown';
}
const keywords: [RegExp, Intent][] = [
  [/authentication|credentials/i, 'validate-authentication'],
  [/configuration|config diff/i, 'compare-configuration'],
  [/root cause|probable cause/i, 'identify-root-cause'],
  [/\brca\b/i, 'generate-rca'],
  [/escalat/i, 'prepare-escalation'],
  [/customer.*update/i, 'draft-customer-update'],
  [/failing test/i, 'review-failing-test'],
  [/run tests|tests pass/i, 'run-tests'],
  [/fix|test failure/i, 'resolve-test-failure'],
  [/pull request/i, 'generate-pull-request-summary'],
  [/document/i, 'update-documentation'],
  [/incident summary/i, 'produce-incident-summary'],
  [/alert/i, 'review-alert'],
  [/telemetry|logs|diagnostic|stack trace|crash dump/i, 'analyze-diagnostic-data'],
  [/search/i, 'search-evidence'],
  [/\b(review|inspect|read|check)\b.*\b(issue|ticket|case|problem)\b/i, 'review-issue-context'],
  [/\b(error signature|exception code|error code)\b/i, 'extract-error-signature'],
  [/\b(recent changes|what changed|commit diff)\b/i, 'identify-changes'],
  [/\b(missing evidence|missing information|more evidence)\b/i, 'identify-missing-evidence'],
  [/\b(execute|rerun|re-run)\b.*\btests?\b/i, 'run-tests'],
  [/\b(collect|gather)\b.*\bevidence\b/i, 'gather-evidence'],
  [/\b(mitigation plan|plan mitigation|rollback plan)\b/i, 'plan-mitigation'],
];
export const intentActions: Record<Exclude<Intent, 'unknown'>, Action> = {
  'review-issue-context': 'review',
  'analyze-diagnostic-data': 'analyze',
  'extract-error-signature': 'analyze',
  'identify-changes': 'compare',
  'validate-authentication': 'validate',
  'compare-configuration': 'compare',
  'search-evidence': 'search',
  'identify-root-cause': 'analyze',
  'identify-missing-evidence': 'review',
  'generate-rca': 'generate',
  'prepare-escalation': 'escalate',
  'draft-customer-update': 'communicate',
  'review-failing-test': 'review',
  'resolve-test-failure': 'edit',
  'run-tests': 'validate',
  'update-documentation': 'document',
  'generate-pull-request-summary': 'summarize',
  'review-alert': 'review',
  'establish-impact': 'analyze',
  'identify-component': 'analyze',
  'gather-evidence': 'inspect',
  'plan-mitigation': 'review',
  'stakeholder-update': 'communicate',
  'produce-incident-summary': 'summarize',
};
export function suggestAction(intent: Intent): WorkflowEvent['suggestedAction'] {
  return intent === 'unknown' ? undefined : { action: intentActions[intent], basis: intent };
}
export function classify(
  action: Action,
  resource: Resource,
  text = '',
  correction?: Intent,
): Classification {
  if (correction && intents.includes(correction))
    return {
      intent: correction,
      confidence: 1,
      method: 'user',
      evidence: 'user-correction',
      contentRequired: false,
    };
  let intent: Intent = 'unknown';
  if (action === 'inspect' && resource === 'log') intent = 'analyze-diagnostic-data';
  if (action === 'validate' && resource === 'test') intent = 'run-tests';
  if (action === 'compare' && resource === 'configuration') intent = 'compare-configuration';
  if (intent !== 'unknown')
    return {
      intent,
      confidence: 0.85,
      method: 'rule',
      evidence: 'metadata',
      contentRequired: false,
    };
  const match = keywords.find(([pattern]) => pattern.test(text));
  return {
    intent: match?.[1] ?? 'unknown',
    confidence: match ? 0.65 : 0.2,
    method: match ? 'keyword' : 'unknown',
    evidence: match ? 'redacted-content' : 'metadata',
    contentRequired: !!match,
  };
}
const scope: Record<Source, ConsentMode> = {
  demo: 'demo-only',
  import: 'user-imported-content',
  metadata: 'metadata-only',
  skilldna: 'skilldna-interactions',
};
export function normalize(
  raw: Record<string, unknown>,
  context: {
    source: Source;
    mode: ConsentMode;
    sessionId: string;
    id: string;
    timestamp?: string;
  },
): WorkflowEvent {
  if (context.mode !== scope[context.source])
    throw new Error('Source not approved by current consent.');
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1)
    throw new Error('Unsupported event schema version.');
  const action = actions.includes(raw.action as Action) ? (raw.action as Action) : 'unknown';
  const resource = resources.includes(raw.resource as Resource)
    ? (raw.resource as Resource)
    : 'unknown';
  const bodies = ['prompt', 'response', 'text', 'content']
    .map((key) => (typeof raw[key] === 'string' ? (raw[key] as string) : ''))
    .join('\n');
  const redacted = redact(bodies);
  const known = intents.includes(raw.intent as Intent) ? (raw.intent as Intent) : undefined;
  const classification = known
    ? {
        intent: known,
        confidence: 0.95,
        method: 'rule' as const,
        evidence: 'metadata' as const,
        contentRequired: false,
      }
    : classify(action, resource, context.source === 'import' ? redacted.text : '');
  const timestamp =
    typeof raw.timestamp === 'string' && Number.isFinite(Date.parse(raw.timestamp))
      ? new Date(raw.timestamp).toISOString()
      : (context.timestamp ?? new Date().toISOString());
  return {
    schemaVersion: 1,
    id: context.id,
    sessionId: context.sessionId,
    timestamp,
    source: context.source,
    action,
    ...(action === 'unknown' && classification.intent !== 'unknown'
      ? { suggestedAction: suggestAction(classification.intent) }
      : {}),
    resource,
    intent: classification.intent,
    classification,
    confidence: classification.confidence,
    tool: ['editor', 'search', 'terminal', 'chat', 'task', 'debug'].includes(String(raw.tool))
      ? (raw.tool as WorkflowEvent['tool'])
      : 'unknown',
    outcome: ['success', 'failure', 'blocked'].includes(String(raw.outcome))
      ? (raw.outcome as WorkflowEvent['outcome'])
      : 'unknown',
    ...(typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs) && raw.durationMs >= 0
      ? { durationMs: raw.durationMs }
      : {}),
    consent: context.mode,
    redaction: {
      status: redacted.categories.length ? 'redacted' : 'clean',
      categories: redacted.categories,
      bodiesRemoved: true,
    },
  };
}
