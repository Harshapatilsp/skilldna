import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDown,
  ArrowRight,
  Check,
  CheckCheck,
  Code,
  Download,
  FileCheck,
  FileText,
  FolderOpen,
  GitBranch,
  LayoutDashboard,
  ListFilter,
  LockKeyhole,
  Pause,
  Play,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { parse, stringify } from 'yaml';
import { Application } from '../../../packages/application';
import { suggestAction } from '../../../packages/privacy';
import {
  emptyState,
  feedbackValues,
  intents,
  label,
  type Candidate,
  type Draft,
  type Session,
  type Validation,
} from '../../../packages/domain';
import type { Message, Snapshot } from '../../../packages/domain/protocol';
import { validate } from '../../../packages/skill-generator/validate';
import './style.css';
declare global {
  interface Window {
    acquireVsCodeApi?: () => { postMessage(message: Message): void };
  }
}
const vscode = window.acquireVsCodeApi?.();
const demo = new Application();
const tabs = ['Overview', 'Workflows', 'Sessions', 'Skill review', 'Privacy'] as const;
type Tab = (typeof tabs)[number];
type Send = (message: Message) => void;
const percent = (value: number) => `${Math.round(value)}%`;
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    state: emptyState(),
    pending: [],
    notice: 'Observation is off. Your data stays on this machine.',
    browser: !vscode,
  });
  const [view, setView] = useState<Tab>('Overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data.type === 'snapshot') {
        setSnapshot(event.data.snapshot);
        if (event.data.snapshot.view) setView(event.data.snapshot.view);
        setBusy(false);
      }
      if (event.data.type === 'error') {
        setError(event.data.message);
        setBusy(false);
      }
    };
    window.addEventListener('message', handler);
    vscode?.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);
  const send: Send = (message) => {
    setError('');
    if (vscode) {
      setBusy(true);
      vscode.postMessage(message);
      return;
    }
    try {
      if (
        [
          'export',
          'import',
          'importPrevious',
          'exportData',
          'startSession',
          'stopSession',
          'copilotConsent',
        ].includes(message.type)
      )
        throw new Error(
          'This operation is available in the VS Code extension. Browser preview uses synthetic data in memory only.',
        );
      if (message.type === 'consent' && !['off', 'demo-only'].includes(message.mode))
        throw new Error('Real data sources require VS Code. This preview is synthetic-only.');
      if (
        message.type === 'deleteAll' &&
        !window.confirm('Delete all in-memory SkillDNA demo data?')
      )
        return;
      demo.handle(message);
      setSnapshot(structuredClone(demo.snapshot(true)));
      setView(demo.view as Tab);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Operation failed.');
    }
  };
  const state = snapshot.state;
  const eventCount = state.sessions.reduce((total, session) => total + session.events.length, 0);
  const observing = !state.consent.paused && state.consent.mode === 'metadata-only';
  return (
    <div className="app">
      <header>
        <div className="brand">
          <GitBranch size={27} />
          <strong>SkillDNA</strong>
          <span className="version">LOCAL-FIRST / MVP</span>
        </div>
        <div className="privacy-status">
          <span className={observing ? 'live-dot' : 'off-dot'} />
          {observing ? 'Observation enabled' : 'Observation off'}
          {snapshot.copilot?.enabled && <span className="badge">Copilot review on</span>}
          <button
            className="icon"
            title="Open privacy center"
            aria-label="Open privacy center"
            onClick={() => setView('Privacy')}
          >
            <ShieldCheck size={18} />
          </button>
        </div>
      </header>
      <nav aria-label="Dashboard views">
        {tabs.map((tab, index) => {
          const Icon = [LayoutDashboard, GitBranch, ListFilter, FileCheck, LockKeyhole][index];
          return (
            <button
              key={tab}
              aria-current={view === tab ? 'page' : undefined}
              className={view === tab ? 'active' : ''}
              onClick={() => setView(tab)}
            >
              <Icon size={16} />
              {tab}
              {tab === 'Workflows' && state.candidates.length > 0 && (
                <span className="count">{state.candidates.length}</span>
              )}
            </button>
          );
        })}
      </nav>
      <main aria-busy={busy}>
        {snapshot.browser && (
          <div className="preview-strip">
            Browser preview · Synthetic data only · No persistence or filesystem export
          </div>
        )}
        <div className="notice" role="status">
          <ShieldCheck size={16} />
          {busy ? 'Working locally...' : snapshot.notice}
        </div>
        {error && (
          <div className="error" role="alert">
            <X size={17} />
            {error}
            <button className="icon" onClick={() => setError('')} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}
        {view === 'Overview' && (
          <>
            <section className="page-heading">
              <div>
                <span className="eyebrow">WORKFLOW INTELLIGENCE</span>
                <h1>Discover skills from previous sessions.</h1>
                <p>
                  Selected session files. Local analysis. Your approval before anything is saved.
                </p>
              </div>
              <div className="onboarding-actions">
                <button
                  className="primary"
                  disabled={busy || snapshot.browser}
                  title={
                    snapshot.browser
                      ? 'Requires the installed VS Code extension'
                      : 'Choose JSON or JSONL session files'
                  }
                  onClick={() => send({ type: 'importPrevious' })}
                >
                  <Upload size={16} />
                  Import previous sessions
                </button>
                <button disabled={busy} onClick={() => send({ type: 'discoverDemo' })}>
                  <Play size={16} />
                  Try discovery demo
                </button>
              </div>
            </section>
            <section className="metrics">
              {[
                [state.sessions.length, 'Approved sessions'],
                [eventCount, 'Normalized events'],
                [state.candidates.length, 'Workflow candidates'],
                [
                  state.candidates.filter(
                    (item) =>
                      item.recommendation === 'Create skill' && item.scores.intentConfidence >= 80,
                  ).length,
                  'High-confidence skill candidates',
                ],
                [
                  snapshot.pending.length +
                    state.drafts.filter((item) => item.status === 'review').length,
                  'Awaiting review',
                ],
              ].map(([value, text]) => (
                <div key={text}>
                  <strong>{value}</strong>
                  <span>{text}</span>
                </div>
              ))}
            </section>
            <section className="overview-columns">
              <div>
                <div className="section-title">
                  <h2>Discovery pipeline</h2>
                  <span className="badge">Local processing</span>
                </div>
                <div className="pipeline">
                  {[
                    ['Import', state.sessions.length > 0 || snapshot.pending.length > 0],
                    ['Normalize', eventCount > 0],
                    ['Detect', state.candidates.length > 0],
                    ['Review', state.drafts.length > 0],
                    ['Export', state.drafts.some((item) => item.status === 'exported')],
                  ].map(([text, complete], index) => (
                    <React.Fragment key={String(text)}>
                      <div className={complete ? 'pipeline-node complete' : 'pipeline-node'}>
                        {complete ? <Check size={19} /> : <span>{index + 1}</span>}
                        <strong>{text}</strong>
                      </div>
                      {index < 4 && <ArrowRight size={17} />}
                    </React.Fragment>
                  ))}
                </div>
                <h2>Data sources</h2>
                <div className="source-list">
                  {[
                    ['Synthetic demo', '25 sessions / 3 workflow families', 'demo'],
                    [
                      'Previous Copilot sessions',
                      'Scoped workspace storage discovery',
                      'importPrevious',
                    ],
                    ['Editor metadata', 'Approved categories only', 'privacy'],
                  ].map(([title, subtitle, type]) => (
                    <button
                      className="source-row"
                      key={title}
                      disabled={busy || (snapshot.browser && type === 'importPrevious')}
                      title={
                        snapshot.browser && type === 'importPrevious'
                          ? 'Requires VS Code'
                          : undefined
                      }
                      onClick={() => send({ type } as Message)}
                    >
                      <span className="source-symbol">
                        <FolderOpen size={20} />
                      </span>
                      <span>
                        <strong>{title}</strong>
                        <small>{subtitle}</small>
                      </span>
                      <ArrowRight size={17} />
                    </button>
                  ))}
                </div>
              </div>
              <aside className="trust-panel">
                <LockKeyhole size={25} />
                <h2>Your workflow. Your control.</h2>
                <p>
                  Observation starts off. Only approved sources are processed. Raw prompts,
                  responses, file contents, and paths are not stored in normalized events.
                </p>
                <ul>
                  <li>Copilot summary review requires separate consent</li>
                  <li>Session discovery only after consent</li>
                  <li>Review before analysis and export</li>
                  <li>Delete local data at any time</li>
                </ul>
                <button onClick={() => setView('Privacy')}>
                  <ShieldCheck size={16} />
                  Privacy center
                </button>
                <p className="muted">
                  Redaction is a best-effort safeguard, not a guarantee of anonymity.
                </p>
              </aside>
            </section>
            <section className="bottom-action">
              <div>
                <h2>
                  {state.candidates.length
                    ? 'Your candidates are ready'
                    : 'Previous sessions, potential skills'}
                </h2>
                <p>
                  {state.sessions.length
                    ? `${state.sessions.length} approved sessions available for discovery`
                    : 'No sessions imported yet.'}
                </p>
                <button disabled={busy} onClick={() => send({ type: 'demo' })}>
                  <Play size={16} />
                  Load synthetic demo
                </button>
              </div>
              <button
                disabled={!state.sessions.length || busy}
                className="primary"
                onClick={() => send({ type: 'analyze' })}
              >
                <Search size={16} />
                Analyze workflows
              </button>
            </section>
          </>
        )}
        {view === 'Workflows' && (
          <Workflows
            candidates={state.candidates}
            sessions={state.sessions}
            send={send}
            busy={busy}
            copilot={snapshot.copilot}
          />
        )}
        {view === 'Sessions' && (
          <Sessions
            key={snapshot.pending[0]?.id ?? 'approved-sessions'}
            sessions={state.sessions}
            pending={snapshot.pending}
            send={send}
            busy={busy}
            browser={snapshot.browser}
          />
        )}
        {view === 'Skill review' && (
          <Review
            drafts={state.drafts}
            send={send}
            serverValidation={snapshot.validation}
            browser={snapshot.browser}
          />
        )}
        {view === 'Privacy' && <Privacy snapshot={snapshot} send={send} busy={busy} />}
      </main>
      <footer>
        <span>
          <LockKeyhole size={13} />
          Data stored locally
          {snapshot.browser ? ' in memory' : ' in extension storage'}
        </span>
        <span>Prompts capture requests. Skills capture procedures.</span>
      </footer>
    </div>
  );
}
function Workflows({
  candidates,
  sessions,
  send,
  busy,
  copilot,
}: {
  candidates: Candidate[];
  sessions: Session[];
  send: Send;
  busy: boolean;
  copilot?: Snapshot['copilot'];
}) {
  const [selected, setSelected] = useState('');
  const [node, setNode] = useState('');
  const [sourceFilter, setSourceFilter] = useState(
    sessions.some((session) => !session.synthetic && session.source === 'import')
      ? 'Imported'
      : 'All',
  );
  const sourceName = (item: Candidate) => {
    const evidence = sessions.filter((session) => item.sessionIds.includes(session.id));
    if (evidence.length && evidence.every((session) => session.synthetic)) return 'Demo';
    if (evidence.length && evidence.every((session) => session.source === 'import'))
      return 'Imported';
    return 'Observed / mixed';
  };
  const visibleCandidates = candidates.filter(
    (item) => sourceFilter === 'All' || sourceName(item) === sourceFilter,
  );
  const relevantSessions = sessions.filter(
    (session) =>
      sourceFilter === 'All' ||
      (sourceFilter === 'Demo'
        ? session.synthetic
        : sourceFilter === 'Imported'
          ? !session.synthetic && session.source === 'import'
          : !session.synthetic && session.source !== 'import'),
  );
  const skills = visibleCandidates.filter((item) => item.recommendation === 'Create skill');
  const combinations = visibleCandidates.filter((item) => item.combinedFrom);
  const individual = visibleCandidates.filter((item) => !item.combinedFrom);
  const candidate = visibleCandidates.find((item) => item.id === selected) ?? visibleCandidates[0];
  const step = candidate?.steps.find((item) => item.intent === node) ?? candidate?.steps[0];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">DISCOVERED PROCEDURES</span>
          <h1>Workflow explorer</h1>
          <p>Distinct-session support, observed variation, and explicit recommendation factors.</p>
        </div>
        <button onClick={() => send({ type: 'analyze' })} disabled={busy}>
          <Search size={16} />
          Analyze again
        </button>
      </div>
      <div className="button-group" role="group" aria-label="Workflow sources">
        {['Imported', 'Demo', 'Observed / mixed', 'All'].map((source) => (
          <button
            key={source}
            aria-pressed={sourceFilter === source}
            onClick={() => {
              setSourceFilter(source);
              setSelected('');
              setNode('');
            }}
          >
            {source}
          </button>
        ))}
      </div>
      <section className="discovery-summary" aria-label="Discovery results">
        <div>
          <span className="eyebrow">DISCOVERY RESULTS</span>
          <h2>{sessions.length} approved sessions analyzed</h2>
          <p>
            {sessions.filter((session) => session.synthetic).length} synthetic ·{' '}
            {sessions.filter((session) => !session.synthetic && session.source === 'import').length}{' '}
            imported ·{' '}
            {sessions.filter((session) => !session.synthetic && session.source !== 'import').length}{' '}
            observed
          </p>
          <h3>{sourceFilter} results</h3>
          <p>
            {relevantSessions.length} sessions in this source · {individual.length} workflow
            candidates · {skills.length} recommended skills
          </p>
          <details className="workflow-disclosure" open>
            <summary>Detected workflows ({individual.length})</summary>
            {individual.length ? (
              <ul>
                {individual.map((item) => (
                  <li key={item.id}>
                    <strong>{item.occurrences}</strong> sessions · {item.name}
                    <small>
                      {sourceName(item)} · {item.recommendation}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                No workflow candidates in this source.{' '}
                {relevantSessions.length
                  ? sourceFilter === 'Imported'
                    ? 'Imported successfully, but no recognizable workflow steps were found.'
                    : 'No recognizable intent sequences were found.'
                  : 'No approved sessions from this source yet.'}
              </p>
            )}
          </details>
        </div>
        <div>
          <h2>Potential skills</h2>
          {skills.length ? (
            <div className="source-list">
              {skills.map((item) => (
                <button
                  className="source-row"
                  key={item.id}
                  disabled={busy}
                  aria-label={`Generate ${item.name}`}
                  onClick={() => send({ type: 'generate', id: item.id })}
                >
                  <Check size={18} />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {sourceName(item)} · {item.occurrences} supporting sessions ·{' '}
                      {item.suitability}/100 suitability
                    </small>
                  </span>
                  <Plus size={17} />
                </button>
              ))}
            </div>
          ) : (
            <p>
              No skill is recommended for this source yet. Review candidate recommendations below; a
              few imported sessions or keyword-only evidence may be insufficient.
            </p>
          )}
        </div>
      </section>
      <section className="discovery-summary" aria-label="Potential combinations">
        <div>
          <h2>Potential combined skills</h2>
          {combinations.length === 0 ? (
            <div role="status">
              <p>
                No compatible workflow combinations were found for this source using the current
                rules.
              </p>
              <p>
                {individual.length} workflow families available in this view;{' '}
                {individual.filter((item) => item.occurrences >= 3).length} have at least three
                supporting sessions.
              </p>
            </div>
          ) : (
            <>
              <p>
                {combinations.length} proposals with repeated, ordered shared steps. Support is
                across variants, not confirmed combined executions.
              </p>
              <div className="source-list">
                {combinations.map((item) => (
                  <button
                    key={item.id}
                    className="source-row"
                    onClick={() => {
                      setSelected(item.id);
                      setNode('');
                    }}
                  >
                    <GitBranch size={18} />
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {item.occurrences} sessions across {item.combinedFrom?.length} variants ·{' '}
                        {item.recommendation}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
      {!candidate ? (
        <Empty
          icon={<GitBranch size={36} />}
          title="No detected workflows yet"
          text="Load synthetic data or approve sessions, then run analysis."
        />
      ) : (
        <div className="explorer">
          <aside>
            <details className="workflow-disclosure" open>
              <summary>Workflow cards ({visibleCandidates.length})</summary>
              <div className="candidate-list">
                {visibleCandidates.map((item) => (
                  <button
                    className={`candidate ${item.id === candidate.id ? 'selected' : ''}`}
                    key={item.id}
                    onClick={() => {
                      setSelected(item.id);
                      setNode('');
                    }}
                  >
                    <span className="badge">
                      {item.recommendation === 'Need more evidence'
                        ? 'Need more info'
                        : item.recommendation}
                    </span>
                    {item.recommendation === 'Need more evidence' && (
                      <small>
                        {item.combinedFrom
                          ? 'Confirm these variants share a goal.'
                          : (item.scores.metadataCompleteness ?? 0) < 100
                            ? 'Actions or results are not confirmed.'
                            : item.occurrences < 3
                              ? 'At least three supporting sessions needed.'
                              : 'Review the identified steps.'}
                      </small>
                    )}
                    <small>{sourceName(item)}</small>
                    {copilot?.enabled && (
                      <small>Copilot: {copilot.reviews[item.id]?.status ?? 'not reviewed'}</small>
                    )}
                    <h3>{item.name}</h3>
                    <div className="candidate-numbers">
                      <strong>
                        {item.occurrences}
                        <small>{item.combinedFrom ? 'across variants' : 'occurrences'}</small>
                      </strong>
                      <strong>
                        {percent(item.scores.stability)}
                        <small>stability</small>
                      </strong>
                    </div>
                    <span className="meter">
                      <span style={{ width: percent(item.suitability) }} />
                    </span>
                    <small>{item.suitability}/100 suitability heuristic</small>
                  </button>
                ))}
              </div>
            </details>
          </aside>
          <section className="workflow-detail">
            <div className="section-title">
              <div>
                <h2>{candidate.name}</h2>
                <span className="muted">
                  {candidate.occurrences} approved sessions ·{' '}
                  {candidate.steps.filter((item) => item.stable).length} stable steps ·{' '}
                  {candidate.steps.filter((item) => !item.stable).length} optional steps
                </span>
              </div>
              <button
                className="primary"
                onClick={() => send({ type: 'generate', id: candidate.id })}
              >
                <Plus size={16} />
                Generate skill draft
              </button>
            </div>
            <section aria-label="Copilot suitability review">
              <h3>Copilot suitability review</h3>
              {!copilot?.enabled ? (
                <p>
                  Off. Local recommendations remain available. Optional Copilot review requires
                  consent in Privacy.
                </p>
              ) : (
                <>
                  <p role="status">
                    {copilot.model} ·{' '}
                    {copilot.reviews[candidate.id]?.status ??
                      'Not reviewed (up to 10 candidates per analysis)'}
                  </p>
                  <p>{copilot.notice}</p>
                  {copilot.reviews[candidate.id]?.assessment && (
                    <>
                      <strong>
                        AI opinion: {copilot.reviews[candidate.id].assessment!.recommendation}
                      </strong>
                      <p>{copilot.reviews[candidate.id].assessment!.rationale}</p>
                      <h4>Missing evidence</h4>
                      <ul>
                        {copilot.reviews[candidate.id].assessment!.missingEvidence.map(
                          (text, index) => (
                            <li key={index}>{text}</li>
                          ),
                        )}
                      </ul>
                      <h4>Risks to review</h4>
                      <ul>
                        {copilot.reviews[candidate.id].assessment!.risks.map((text, index) => (
                          <li key={index}>{text}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <p>
                    Local recommendation: <strong>{candidate.recommendation}</strong>. AI opinions
                    do not confirm execution, fill missing evidence, or approve a skill.
                  </p>
                </>
              )}
            </section>
            {candidate.combinedFrom && (
              <section aria-label="Combination evidence">
                <p>
                  Potential combination, not a verified end-to-end workflow. Review the original
                  variants before generating a draft.
                </p>
                <div className="button-group">
                  {candidate.combinedFrom.map((id, index) => (
                    <button
                      key={id}
                      onClick={() => {
                        setSelected(id);
                        setNode('');
                      }}
                    >
                      <GitBranch size={16} />
                      Variant {index + 1}:{' '}
                      {candidates.find((item) => item.id === id)?.name ?? 'Original workflow'}
                    </button>
                  ))}
                </div>
              </section>
            )}
            <div className="flow-layout">
              <div className="flow">
                <span className="flow-label">ENTRY: {candidate.entries.map(label).join(', ')}</span>
                {candidate.steps.map((item, index) => (
                  <React.Fragment key={item.intent}>
                    {index > 0 && !candidate.combinedFrom && (
                      <ArrowDown className="connector" size={16} />
                    )}
                    <button
                      className={`step ${item.stable ? 'stable' : 'optional'} ${step?.intent === item.intent ? 'chosen' : ''}`}
                      onClick={() => setNode(item.intent)}
                    >
                      <span className="step-number">{String(index + 1).padStart(2, '0')}</span>
                      <span>
                        {label(item.intent)}
                        <small>
                          {item.stable ? 'Stable' : 'Optional'} · {percent(item.rate * 100)} of
                          sessions
                        </small>
                      </span>
                      <span className="step-type">
                        {item.action === 'unknown' ? 'Not recorded' : item.action}
                      </span>
                    </button>
                  </React.Fragment>
                ))}
                <span className="flow-label">EXITS: {candidate.exits.map(label).join(' / ')}</span>
              </div>
              <aside className="node-detail">
                <GitBranch size={22} />
                <h3>{step && label(step.intent)}</h3>
                <dl>
                  <dt>Event type</dt>
                  <dd>{step?.action === 'unknown' ? 'Not recorded' : step?.action}</dd>
                  <dt>Occurrence rate</dt>
                  <dd>{percent((step?.rate ?? 0) * 100)}</dd>
                  <dt>Intent confidence</dt>
                  <dd>{percent((step?.confidence ?? 0) * 100)} heuristic</dd>
                  <dt>Sources</dt>
                  <dd>{step?.sources.join(', ')}</dd>
                  <dt>Preceding</dt>
                  <dd>{step?.preceding.map(label).join(', ') || 'Entry point'}</dd>
                  <dt>Following</dt>
                  <dd>{step?.following.map(label).join(', ') || 'Exit point'}</dd>
                </dl>
                <p>
                  {step?.stable
                    ? 'Observed in at least 80% of cluster members.'
                    : 'Observed in a subset of sessions; retained as a conditional path.'}
                </p>
              </aside>
            </div>
            <div className="detail-grid">
              <section>
                <h3>Why this recommendation</h3>
                {candidate.explanation.map((text) => (
                  <p key={text}>{text}</p>
                ))}
                <h3>Required inputs</h3>
                <ul>
                  {candidate.inputs.map((input) => (
                    <li key={input}>{input}</li>
                  ))}
                </ul>
                <h3>Observed outputs</h3>
                <ul>
                  {candidate.outputs.map((output) => (
                    <li key={output}>{output}</li>
                  ))}
                </ul>
                <label>
                  Recommendation feedback
                  <select
                    defaultValue=""
                    onChange={(event) =>
                      send({
                        type: 'feedback',
                        id: candidate.id,
                        value: event.target.value as (typeof feedbackValues)[number],
                      })
                    }
                  >
                    <option disabled value="">
                      Choose feedback
                    </option>
                    {feedbackValues.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              </section>
              <section>
                <h3>Score breakdown</h3>
                {(candidate.scores.metadataCompleteness ?? 0) < 100 && (
                  <p>
                    Metadata is incomplete. Risk scores are lower bounds, not confirmed low risk. A
                    zero means no risk signal was identified in the available evidence.
                  </p>
                )}
                {Object.entries(candidate.scores).map(([key, value]) => (
                  <div className="score-row" key={key}>
                    <span>{key.replace(/([A-Z])/g, ' $1')}</span>
                    <meter min="0" max="100" value={value} />
                    <strong>{Math.round(value)}</strong>
                  </div>
                ))}
                <details>
                  <summary>Mining evidence</summary>
                  {candidate.frequentSequences.map((sequence, index) => (
                    <p key={index}>
                      {sequence.intents.map(label).join(' → ')} <b>({sequence.support} sessions)</b>
                    </p>
                  ))}
                </details>
              </section>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function Sessions({
  sessions,
  pending,
  send,
  busy,
  browser,
}: {
  sessions: Session[];
  pending: Session[];
  send: Send;
  busy: boolean;
  browser: boolean;
}) {
  const [excluded, setExcluded] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [confirmDeleteImported, setConfirmDeleteImported] = useState(false);
  const all = [...pending, ...sessions];
  const groups = [
    { name: 'Demo sessions', items: all.filter((item) => item.synthetic) },
    {
      name: 'Observed sessions',
      items: all.filter((item) => !item.synthetic && item.source !== 'import'),
    },
    {
      name: 'Imported sessions',
      items: all.filter((item) => !item.synthetic && item.source === 'import'),
    },
  ];
  const session =
    all.find((item) => item.id === selected) ?? pending[0] ?? groups[2].items.at(-1) ?? all[0];
  const topic = (item: Session) => {
    const topics = [
      ...new Set(item.events.map((event) => event.intent).filter((intent) => intent !== 'unknown')),
    ];
    return topics.slice(0, 2).map(label).join(' / ') || 'No recognizable workflow steps';
  };
  const imported = groups[2].items;
  const importedPending = imported.filter((item) => !item.approved);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">NORMALIZED EVIDENCE</span>
          <h1>Sessions</h1>
          <p>No raw prompts, responses, paths, or imported identifiers.</p>
        </div>
        <button
          disabled={busy || browser}
          title={browser ? 'Requires VS Code' : undefined}
          onClick={() => send({ type: 'importPrevious' })}
        >
          <Upload size={16} />
          Import sessions
        </button>
      </div>
      {imported.length > 0 && (
        <section className="discovery-summary" aria-label="Imported session summary">
          <div>
            <h2>Imported session evidence</h2>
            <p>
              {imported.length} imported · {importedPending.length} pending review ·{' '}
              {imported.filter((item) => item.approved).length} approved
            </p>
            <p>
              {imported.reduce((total, item) => total + item.events.length, 0)} events ·{' '}
              {imported.reduce(
                (total, item) =>
                  total + item.events.filter((event) => event.intent !== 'unknown').length,
                0,
              )}{' '}
              with an identified intent
            </p>
          </div>
          <div>
            <h3>
              {!imported.some((item) => item.events.some((event) => event.intent !== 'unknown'))
                ? 'Insufficient workflow evidence'
                : importedPending.length
                  ? 'Review before discovery'
                  : 'Ready for workflow discovery'}
            </h3>
            <button
              className="primary"
              disabled={busy || !imported.some((item) => item.approved)}
              onClick={() => send({ type: 'analyze' })}
            >
              <Search size={16} />
              Discover workflows from approved sessions
            </button>
            {confirmDeleteImported ? (
              <div className="button-group" role="group" aria-label="Confirm delete imported">
                <span>Delete all {imported.length} imported sessions?</span>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    setConfirmDeleteImported(false);
                    setSelected('');
                    send({ type: 'deleteImported' });
                  }}
                >
                  <Trash2 size={16} />
                  Delete imported
                </button>
                <button disabled={busy} onClick={() => setConfirmDeleteImported(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="danger"
                disabled={busy}
                onClick={() => setConfirmDeleteImported(true)}
              >
                <Trash2 size={16} />
                Delete all imported sessions
              </button>
            )}
          </div>
        </section>
      )}
      {pending.length > 0 && (
        <div className="approval-bar">
          <strong>Found {pending.length} sessions · pending review</strong>
          <button
            className="primary"
            disabled={busy || !pending.some((item) => !excluded.includes(item.id))}
            onClick={() =>
              send({
                type: 'approveSessions',
                ids: pending.filter((item) => !excluded.includes(item.id)).map((item) => item.id),
                analyze: true,
              })
            }
          >
            <CheckCheck size={16} />
            Approve and discover
          </button>
          <button disabled={busy} onClick={() => send({ type: 'discardPending' })}>
            <Trash2 size={16} />
            Discard all pending
          </button>
        </div>
      )}
      {!session ? (
        <Empty
          icon={<ListFilter size={36} />}
          title="No sessions yet"
          text="Choose a source from Overview. Imported and observed sessions appear here for review before analysis."
        />
      ) : (
        <div className="session-layout">
          <aside className="session-list" aria-label="Sessions by source">
            {groups
              .filter((group) => group.items.length)
              .map((group) => (
                <section key={group.name} aria-label={group.name}>
                  <details className="session-group" open>
                    <summary>
                      <h3>
                        {group.name} ({group.items.length})
                      </h3>
                    </summary>
                    {group.items.map((item, index) => (
                      <div key={item.id} className="session-row">
                        {!item.approved && (
                          <input
                            type="checkbox"
                            aria-label={`Include session ${pending.findIndex((entry) => entry.id === item.id) + 1}`}
                            checked={!excluded.includes(item.id)}
                            onChange={(event) =>
                              setExcluded(
                                event.target.checked
                                  ? excluded.filter((id) => id !== item.id)
                                  : [...excluded, item.id],
                              )
                            }
                          />
                        )}
                        <button
                          className={session.id === item.id ? 'active' : ''}
                          onClick={() => setSelected(item.id)}
                        >
                          <strong>
                            {item.synthetic
                              ? 'Demo'
                              : item.source === 'import'
                                ? 'Imported'
                                : 'Observed'}{' '}
                            session {index + 1}
                          </strong>
                          <small>{topic(item)}</small>
                          <small>
                            {item.events.length} events · {item.approved ? 'Approved' : 'Pending'}
                          </small>
                        </button>
                      </div>
                    ))}
                  </details>
                </section>
              ))}
          </aside>
          <section>
            <div className="section-title">
              <div>
                <h2>
                  {session.synthetic
                    ? 'Demo session'
                    : session.source === 'import'
                      ? 'Imported session'
                      : 'Observed session'}{' '}
                  review
                </h2>
                <p>
                  {session.approved ? 'Approved' : 'Pending approval'} · {session.events.length}{' '}
                  events · {topic(session)}
                </p>
              </div>
              <button
                className="icon danger"
                title="Delete session and derived data"
                aria-label="Delete session and derived data"
                onClick={() => send({ type: 'deleteSession', id: session.id })}
              >
                <Trash2 size={17} />
              </button>
            </div>
            {!session.synthetic &&
              session.source === 'import' &&
              !session.events.some((event) => event.intent !== 'unknown') && (
                <p role="status">
                  Imported successfully, but no recognizable workflow steps were found.
                </p>
              )}
            {session.events.some(
              (event) => event.action === 'unknown' || event.outcome === 'unknown',
            ) && <p>Missing metadata is missing evidence, not evidence of low risk.</p>}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Inferred intent / correction</th>
                    <th>Confirmed outcome</th>
                    <th>Privacy processing</th>
                  </tr>
                </thead>
                <tbody>
                  {session.events.map((event) => (
                    <tr key={event.id}>
                      <td>
                        {event.action !== 'unknown' ? (
                          <>
                            {label(event.action)}
                            <small>Recorded by source</small>
                          </>
                        ) : suggestAction(event.intent) ? (
                          <>
                            {label(suggestAction(event.intent)!.action)}
                            <small>Suggested from intent, not confirmed execution</small>
                            <small>Basis: {label(event.intent)}</small>
                          </>
                        ) : (
                          'Not recorded'
                        )}
                      </td>
                      <td>
                        <select
                          aria-label={`Intent for ${event.id}`}
                          value={event.intent}
                          onChange={(change) =>
                            send({
                              type: 'correct',
                              sessionId: session.id,
                              eventId: event.id,
                              intent: change.target.value as (typeof intents)[number],
                            })
                          }
                        >
                          {intents.map((intent) => (
                            <option key={intent} value={intent}>
                              {intent === 'unknown'
                                ? 'No recognizable workflow step'
                                : label(intent)}
                            </option>
                          ))}
                        </select>
                        <small>
                          {event.classification.method === 'keyword'
                            ? `Keyword inference · ${percent(event.confidence * 100)} heuristic, not measured accuracy`
                            : event.classification.method === 'user'
                              ? 'User-corrected intent'
                              : event.classification.method === 'unknown'
                                ? 'No matching intent rule'
                                : `Rule-based classification · ${percent(event.confidence * 100)} heuristic`}
                        </small>
                      </td>
                      <td>
                        {event.outcome === 'unknown' ? 'Not confirmed' : label(event.outcome)}
                      </td>
                      <td>
                        {event.redaction.categories.length
                          ? `Removed: ${event.redaction.categories.join(', ')}`
                          : 'No sensitive patterns detected'}
                        <small>Raw text not retained</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details>
              <summary>Normalized JSON and segmentation evidence</summary>
              <pre>{JSON.stringify(session, null, 2)}</pre>
            </details>
          </section>
        </div>
      )}
    </>
  );
}
function Review({
  drafts,
  send,
  serverValidation,
  browser,
}: {
  drafts: Draft[];
  send: Send;
  serverValidation?: Validation;
  browser: boolean;
}) {
  const [selected, setSelected] = useState('');
  const draft = drafts.find((item) => item.id === selected) ?? drafts.at(-1);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">HUMAN REVIEW REQUIRED</span>
          <h1>Skill review</h1>
          <p>Review the workflow, instructions, graph, and result template before export.</p>
        </div>
        {drafts.length > 0 && (
          <select
            aria-label="Select draft"
            value={draft?.id}
            onChange={(event) => setSelected(event.target.value)}
          >
            {drafts.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name} · {item.status}
              </option>
            ))}
          </select>
        )}
      </div>
      {draft ? (
        <DraftEditor
          key={draft.id}
          draft={draft}
          send={send}
          serverValidation={serverValidation}
          browser={browser}
        />
      ) : (
        <Empty
          icon={<FileCheck size={36} />}
          title="No skill drafts yet"
          text="Review a detected workflow, then generate its skill draft."
        />
      )}
    </>
  );
}
function DraftEditor({
  draft,
  send,
  serverValidation,
  browser,
}: {
  draft: Draft;
  send: Send;
  serverValidation?: Validation;
  browser: boolean;
}) {
  const [name, setName] = useState(draft.name);
  const [files, setFiles] = useState(draft.files);
  const [file, setFile] = useState('SKILL.md');
  const [mode, setMode] = useState('Sections');
  const [reviewed, setReviewed] = useState(false);
  const [report, setReport] = useState<Validation>();
  const dirty = name !== draft.name || JSON.stringify(files) !== JSON.stringify(draft.files);
  const markdown = files['SKILL.md'];
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  let description = '';
  try {
    description = match ? String(parse(match[1]).description ?? '') : '';
  } catch {
    /* Invalid frontmatter remains editable as Markdown. */
  }
  const body = match ? markdown.slice(match[0].length) : markdown;
  const parts = body.split(/(?=^## )/m).filter((part) => part.trim());
  const update = (next: Record<string, string>) => {
    setFiles(next);
    setReviewed(false);
    setReport(undefined);
  };
  const header = (nextName: string, nextDescription: string) =>
    `---\n${stringify({ name: nextName, description: nextDescription })}---\n${body}`;
  const save = (status: 'review' | 'approved' | 'rejected' | 'later') => {
    const result = validate({ name, files });
    setReport(result);
    if (!result.errors.length) send({ type: 'saveDraft', id: draft.id, name, files, status });
  };
  const displayReport = report ?? serverValidation;
  return (
    <>
      <div className="draft-toolbar">
        <label>
          Skill directory
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              update({
                ...files,
                'SKILL.md': header(event.target.value, description),
              });
            }}
          />
        </label>
        <span className="badge">{dirty ? 'Unsaved edits' : draft.status}</span>
        <div className="button-group">
          <button title="Save draft" onClick={() => save('review')}>
            <Save size={16} />
            Save
          </button>
          <button
            onClick={() => {
              const result = validate({ name, files });
              setReport(result);
              if (!dirty) send({ type: 'validate', id: draft.id });
            }}
          >
            <ShieldCheck size={16} />
            Validate
          </button>
          <button
            className="primary"
            disabled={
              dirty || draft.status !== 'approved' || validate({ name, files }).errors.length > 0
            }
            onClick={() => send({ type: 'export', id: draft.id })}
          >
            <Download size={16} />
            Export skill
          </button>
        </div>
      </div>
      <div className="file-tabs">
        {Object.keys(files).map((path) => (
          <button
            className={file === path ? 'active' : ''}
            key={path}
            onClick={() => setFile(path)}
          >
            <FileText size={15} />
            {path}
          </button>
        ))}
      </div>
      <div className="editor-controls" role="group" aria-label="Editor view">
        {['Sections', 'Markdown', 'Preview'].map((value) => (
          <button
            key={value}
            className={mode === value ? 'active' : ''}
            onClick={() => setMode(value)}
          >
            {value === 'Markdown' ? <Code size={15} /> : <FileText size={15} />} {value}
          </button>
        ))}
      </div>
      {mode === 'Preview' ? (
        <article className="markdown-preview">
          <ReactMarkdown>{files[file]}</ReactMarkdown>
        </article>
      ) : file === 'SKILL.md' && mode === 'Sections' && match ? (
        <div className="section-editor">
          <label>
            Description
            <textarea
              aria-label="Description"
              rows={3}
              value={description}
              onChange={(event) =>
                update({
                  ...files,
                  'SKILL.md': header(name, event.target.value),
                })
              }
            />
          </label>
          {parts.map((part, index) => {
            const newline = part.indexOf('\n');
            const title = part.slice(0, newline).replace(/^## /, '');
            return (
              <label key={`${index}-${title}`}>
                {title}
                <textarea
                  aria-label={title}
                  rows={Math.min(12, Math.max(3, part.split('\n').length))}
                  value={part.slice(newline + 1).trim()}
                  onChange={(event) => {
                    const next = [...parts];
                    next[index] = `## ${title}\n\n${event.target.value}\n\n`;
                    update({
                      ...files,
                      'SKILL.md': match[0] + '\n' + next.join(''),
                    });
                  }}
                />
              </label>
            );
          })}
        </div>
      ) : (
        <textarea
          className="code-editor"
          aria-label={`Edit ${file}`}
          spellCheck={false}
          value={files[file]}
          onChange={(event) => update({ ...files, [file]: event.target.value })}
        />
      )}
      <section className="review-approval">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
          />
          I reviewed the workflow and every generated file, including privacy and safety rules.
        </label>
        <div className="button-group">
          <button disabled={!reviewed} onClick={() => save('approved')}>
            <Check size={16} />
            Approve draft
          </button>
          <button onClick={() => save('later')}>
            <Save size={16} />
            Save for later
          </button>
          <button onClick={() => save('rejected')}>
            <X size={16} />
            Reject
          </button>
        </div>
        <p className="muted">
          {browser
            ? 'Filesystem export requires the VS Code extension.'
            : 'Destination: selected workspace / .github / skills / ' +
              name +
              '. A native confirmation is required. Existing skills are never overwritten.'}
        </p>
      </section>
      {displayReport && (
        <section className="validation-report" aria-live="polite">
          <h2>Validation results</h2>
          {(['errors', 'warnings', 'recommendations'] as const).map((kind) => (
            <div key={kind}>
              <h3>
                {kind} ({displayReport[kind].length})
              </h3>
              {displayReport[kind].length ? (
                <ul>
                  {displayReport[kind].map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              ) : (
                <p>None</p>
              )}
            </div>
          ))}
        </section>
      )}
      <section>
        <h2>Synthetic test request</h2>
        <pre>
          Use {name} with synthetic diagnostic evidence. Identify missing inputs, distinguish
          findings from assumptions, and draft a result for review. Do not execute changes or send
          messages.
        </pre>
      </section>
    </>
  );
}
function Privacy({ snapshot, send, busy }: { snapshot: Snapshot; send: Send; busy: boolean }) {
  const { state } = snapshot;
  const dataSources = {
    off: {
      label: 'Off',
      description:
        'No new activity is collected. Previously approved sessions remain available until you delete them or they expire.',
    },
    'demo-only': {
      label: 'Sample data only',
      description:
        'Use fictional example sessions to try SkillDNA. Your editor activity and chats are not collected. This choice does not load the examples automatically.',
    },
    'metadata-only': {
      label: 'VS Code activity',
      description:
        'Record categories for workspace files opened, saved, or created, tasks started, and debugging started or stopped. File contents, full paths, terminal output, and chat messages are not recorded.',
    },
    'user-imported-content': {
      label: 'user-imported-content',
      description:
        'Discover previous Copilot sessions in the workspace storage scope you select, after consent. Only workspace identifiers and chatSessions JSON/JSONL files are read. Raw conversations are not saved or uploaded; source files are unchanged.',
    },
  };
  const mode = state.consent.mode === 'skilldna-interactions' ? 'off' : state.consent.mode;
  const source = dataSources[mode];
  const canObserve = !snapshot.browser && state.consent.mode === 'metadata-only';
  const observing = canObserve && !state.consent.paused;
  const [idle, setIdle] = useState(state.settings.idleMinutes);
  const [retention, setRetention] = useState(state.settings.retentionDays);
  const categories = state.sessions.flatMap((session) =>
    session.events.flatMap((event) => event.redaction.categories),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CONSENT & CONTROL</span>
          <h1>Privacy center</h1>
          <p>
            Analysis is local by default. Optional Copilot review sends approved, minimized
            summaries to your selected model provider.
          </p>
        </div>
        <ShieldCheck size={35} />
      </div>
      <div className="privacy-grid">
        <section>
          <h2>What can SkillDNA collect?</h2>
          <label>
            Data source
            <select
              aria-label="Data source"
              aria-describedby="data-source-description"
              value={mode}
              onChange={(event) =>
                send({
                  type: 'consent',
                  mode: event.target.value as typeof mode,
                })
              }
            >
              {Object.entries(dataSources).map(([mode, details]) => (
                <option
                  key={mode}
                  value={mode}
                  disabled={snapshot.browser && !['off', 'demo-only'].includes(mode)}
                >
                  {details.label}
                  {snapshot.browser && !['off', 'demo-only'].includes(mode)
                    ? ' (requires VS Code)'
                    : ''}
                </option>
              ))}
            </select>
          </label>
          <p id="data-source-description">{source.description}</p>
          <p role="status">
            {snapshot.browser
              ? 'Browser preview: synthetic data only. Observation requires the VS Code extension.'
              : canObserve
                ? `${observing ? 'Collecting' : 'Collection paused'}: ${source.label}.`
                : state.consent.mode === 'user-imported-content'
                  ? 'Ready for file import. Background collection is off.'
                  : 'Background collection is off.'}
          </p>
          <p>
            Choose one source at a time. Changing this choice discards sessions you have not yet
            approved. Already approved sessions are kept. Review new sessions in Sessions before
            saving or analyzing them. Activity collection pauses whenever the extension restarts.
          </p>
          <div className="button-group">
            <button
              disabled={!canObserve}
              onClick={() => send({ type: state.consent.paused ? 'resume' : 'pause' })}
            >
              {state.consent.paused ? <Play size={16} /> : <Pause size={16} />}{' '}
              {state.consent.paused ? 'Resume observation' : 'Pause observation'}
            </button>
            <button disabled={!observing} onClick={() => send({ type: 'startSession' })}>
              <Plus size={16} />
              Start session
            </button>
            <button disabled={!observing} onClick={() => send({ type: 'stopSession' })}>
              <Pause size={16} />
              Stop session
            </button>
          </div>
          <h2>Copilot suitability review</h2>
          <label className="review-acknowledgement">
            <input
              type="checkbox"
              checked={snapshot.copilot?.enabled ?? false}
              disabled={snapshot.browser || busy}
              onChange={(event) => send({ type: 'copilotConsent', enabled: event.target.checked })}
            />
            Review workflow suitability with Copilot
          </label>
          <p>
            Off by default. Enabling requires native confirmation and model access consent. Sends
            only approved action, intent and resource categories, repetition and outcome counts, and
            local recommendations. No raw chats, file contents, paths, names or session identifiers.
          </p>
          <p>
            This is not local-only and consumes your Copilot quota. Reviews run after explicit
            analysis, not on every observed event. Permission, model selection and cached results
            reset when this window restarts. Disabling cancels pending requests and clears local
            reviews; already sent data cannot be recalled.
          </p>
          <p role="status">
            {snapshot.browser
              ? 'Copilot review requires the VS Code extension.'
              : (snapshot.copilot?.notice ?? 'Copilot review is off.')}
          </p>
          {snapshot.copilot?.model && <p>Selected model: {snapshot.copilot.model}</p>}
          <h2>Retention and segmentation</h2>
          <div className="field-row">
            <label>
              Retention days
              <input
                type="number"
                min={1}
                max={365}
                value={retention}
                onChange={(event) => setRetention(Number(event.target.value))}
              />
            </label>
            <label>
              Idle boundary (minutes)
              <input
                type="number"
                min={1}
                max={240}
                value={idle}
                onChange={(event) => setIdle(Number(event.target.value))}
              />
            </label>
          </div>
          <button
            onClick={() =>
              send({
                type: 'settings',
                idleMinutes: idle,
                retentionDays: retention,
              })
            }
          >
            <Save size={16} />
            Save settings
          </button>
          <h2>Stored data</h2>
          <p>
            {state.sessions.length} sessions · {state.drafts.length} drafts · {state.audit.length}{' '}
            content-free audit entries
          </p>
          <div className="button-group">
            <button onClick={() => send({ type: 'exportData' })}>
              <Download size={16} />
              Export my data
            </button>
            <button className="danger" onClick={() => send({ type: 'deleteAll' })}>
              <Trash2 size={16} />
              Delete all data
            </button>
          </div>
          <p className="muted">
            Deletion includes stored sessions, derived candidates, drafts, feedback, and audit
            records. Exported repository files and user-selected data exports are not deleted.
          </p>
        </section>
        <section>
          <h2>What is collected</h2>
          <ul>
            <li>Approved action and intent categories</li>
            <li>Generalized resource and tool categories</li>
            <li>Timestamps, outcomes, and heuristic confidence</li>
            <li>Consent, redaction metadata, and local feedback</li>
          </ul>
          <h2>What is not collected</h2>
          <ul>
            <li>Other Copilot participants' conversations</li>
            <li>Source code or complete file contents</li>
            <li>Raw prompt and response bodies</li>
            <li>Full file paths or imported customer identifiers</li>
            <li>Terminal command text, keystrokes, or employee rankings</li>
          </ul>
          <h2>Redaction summary</h2>
          <p>
            {categories.length} detected category occurrences. Typed values are removed before
            persistence.
          </p>
          {[...new Set(categories)].map((category) => (
            <span className="badge" key={category}>
              {category}: {categories.filter((value) => value === category).length}
            </span>
          ))}
          <p>
            Identifier and secret detection is best effort. Unknown names and proprietary facts may
            not be recognized. Only allowlisted normalized fields are retained; every generated
            draft still requires human review.
          </p>
          <details>
            <summary>Audit records</summary>
            <pre>{JSON.stringify(state.audit, null, 2)}</pre>
          </details>
        </section>
      </div>
    </>
  );
}
function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <section className="empty">
      {icon}
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
