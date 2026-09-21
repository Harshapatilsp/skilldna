import { emptyState, type AuditAction, type Session, type State } from '../domain';
import type { Message, Snapshot } from '../domain/protocol';
import { classify, suggestAction } from '../privacy';
import { demoSessions } from '../../samples/demo';
import { SequenceMiner } from '../workflow-engine';
import { rerank } from '../workflow-engine/scoring';
import { generate } from '../skill-generator';
import { validate } from '../skill-generator/validate';
export class Application {
  pending: Session[] = [];
  validation?: Snapshot['validation'];
  notice = 'Observation is off. Nothing is collected until you approve a source.';
  view = 'Overview';
  constructor(public state: State = emptyState()) {}
  audit(action: AuditAction) {
    this.state.audit.push({
      schemaVersion: 1,
      action,
      timestamp: new Date().toISOString(),
    });
    this.state.audit = this.state.audit.slice(-500);
  }
  expire(now = Date.now()) {
    const cutoff = now - this.state.settings.retentionDays * 86_400_000;
    const before = this.state.sessions.length;
    this.state.sessions = this.state.sessions.filter(
      (session) => session.synthetic || Date.parse(session.createdAt) >= cutoff,
    );
    if (before !== this.state.sessions.length) {
      this.state.candidates = [];
      this.state.drafts = [];
      this.state.feedback = [];
    }
    this.state.audit = this.state.audit.filter((entry) => Date.parse(entry.timestamp) >= cutoff);
  }
  snapshot(browser = false): Snapshot {
    return {
      state: this.state,
      pending: this.pending,
      validation: this.validation,
      notice: this.notice,
      browser,
      view: this.view,
    };
  }
  handle(message: Message) {
    switch (message.type) {
      case 'discoverDemo':
        this.handle({ type: 'demo' });
        this.handle({ type: 'analyze' });
        break;
      case 'demo':
        this.pending = [];
        this.state.sessions = [
          ...this.state.sessions.filter((session) => !session.synthetic),
          ...demoSessions(),
        ];
        if (this.state.consent.mode === 'off')
          this.state.consent = {
            schemaVersion: 1,
            mode: 'demo-only',
            paused: true,
          };
        this.notice = '25 synthetic sessions loaded. No user activity collected.';
        this.view = 'Sessions';
        break;
      case 'analyze':
        this.state.candidates = new SequenceMiner().mine(this.state.sessions, this.state.feedback);
        this.audit('analysis');
        this.view = 'Workflows';
        this.notice = `${this.state.candidates.length} workflow candidates detected from ${this.state.sessions.length} approved sessions.${this.state.candidates.length ? '' : ' No repeated workflows met the detection criteria. Import more related sessions to build evidence.'}`;
        break;
      case 'generate': {
        const candidate = this.state.candidates.find((item) => item.id === message.id);
        if (!candidate) throw new Error('Select a detected workflow first.');
        const draft = generate(candidate, new Date().toISOString().slice(0, 10));
        if (this.state.drafts.some((item) => item.id === draft.id))
          throw new Error('A draft already exists. Review it without replacing your edits.');
        this.state.drafts.push(draft);
        this.audit('draft-generated');
        this.view = 'Skill review';
        this.notice = 'Draft generated locally. Review every file before approving export.';
        break;
      }
      case 'validate': {
        const draft = this.state.drafts.find((item) => item.id === message.id);
        if (!draft) throw new Error('Select a draft first.');
        this.validation = validate(draft);
        this.audit('validation');
        this.notice = `Validation: ${this.validation.errors.length} errors, ${this.validation.warnings.length} warnings.`;
        break;
      }
      case 'saveDraft': {
        const draft = this.state.drafts.find((item) => item.id === message.id);
        if (!draft) throw new Error('Draft not found.');
        const updated = {
          ...draft,
          name: message.name,
          files: message.files,
          status: message.status,
        };
        const report = validate(updated);
        this.validation = report;
        if (report.errors.length) {
          this.notice = 'Draft was not persisted: resolve critical validation errors.';
          break;
        }
        Object.assign(draft, updated);
        this.notice = `Draft saved: ${draft.status}.`;
        break;
      }
      case 'consent':
        this.view = 'Privacy';
        this.pending = [];
        this.state.consent = {
          schemaVersion: 1,
          mode: message.mode,
          paused: ['off', 'demo-only', 'user-imported-content'].includes(message.mode),
        };
        this.audit('consent-changed');
        this.notice = `Consent mode: ${message.mode}. Raw bodies are never persisted.`;
        break;
      case 'pause':
        this.view = 'Privacy';
        this.state.consent.paused = true;
        this.audit('consent-changed');
        this.notice = 'Observation paused.';
        break;
      case 'resume':
        this.view = 'Privacy';
        if (this.state.consent.mode === 'metadata-only') {
          this.state.consent.paused = false;
          this.audit('consent-changed');
          this.notice = 'Observation resumed for the approved source.';
        } else throw new Error('Enable an observation source in Privacy first.');
        break;
      case 'approveSessions': {
        const selected = this.pending
          .filter((session) => message.ids.includes(session.id))
          .map((session) => ({ ...session, approved: true }));
        if (message.analyze && !selected.length)
          throw new Error('Select at least one pending session before discovery.');
        if (this.state.sessions.length + selected.length > 500)
          throw new Error('Maximum 500 sessions. Delete older sessions first.');
        this.state.sessions.push(...selected);
        this.pending = [];
        this.audit('import-completed');
        this.notice = `${selected.length} normalized sessions approved; excluded sessions discarded.`;
        if (message.analyze) this.handle({ type: 'analyze' });
        break;
      }
      case 'discardPending':
        this.pending = [];
        this.notice = 'Pending data discarded from memory.';
        break;
      case 'deleteSession':
        this.state.sessions = this.state.sessions.filter((session) => session.id !== message.id);
        this.pending = this.pending.filter((session) => session.id !== message.id);
        this.state.candidates = [];
        this.state.drafts = [];
        this.state.feedback = [];
        this.notice = 'Session and derived candidates/drafts deleted.';
        break;
      case 'correct': {
        const session = [...this.pending, ...this.state.sessions].find(
          (item) => item.id === message.sessionId,
        );
        const event = session?.events.find((item) => item.id === message.eventId);
        if (event) {
          event.classification = classify(event.action, event.resource, '', message.intent);
          event.intent = message.intent;
          if (event.action === 'unknown') {
            const suggestion = suggestAction(message.intent);
            if (suggestion) event.suggestedAction = suggestion;
            else delete event.suggestedAction;
          }
          event.confidence = 1;
          this.state.candidates = [];
          this.notice = 'Intent corrected. Run analysis again.';
        }
        break;
      }
      case 'feedback':
        this.state.feedback.push({
          schemaVersion: 1,
          candidateId: message.id,
          value: message.value,
          timestamp: new Date().toISOString(),
        });
        this.state.candidates = this.state.candidates
          .map((candidate) => rerank(candidate, this.state.feedback))
          .sort((left, right) => right.suitability - left.suitability);
        this.notice = 'Feedback saved locally. No prompt content recorded.';
        break;
      case 'settings':
        this.state.settings = {
          schemaVersion: 1,
          idleMinutes: message.idleMinutes,
          retentionDays: message.retentionDays,
        };
        this.expire();
        this.notice = 'Retention and session settings updated.';
        break;
      case 'deleteAll':
        this.state = emptyState();
        this.pending = [];
        this.validation = undefined;
        this.notice =
          'All stored SkillDNA data deleted. Observation is off. Exported files are unchanged.';
        this.view = 'Privacy';
        break;
      case 'deleteImported': {
        const isImported = (session: Session) => session.source === 'import' && !session.synthetic;
        const removed =
          this.state.sessions.filter(isImported).length + this.pending.filter(isImported).length;
        this.state.sessions = this.state.sessions.filter((session) => !isImported(session));
        this.pending = this.pending.filter((session) => !isImported(session));
        this.state.candidates = this.state.sessions.length
          ? new SequenceMiner().mine(this.state.sessions, this.state.feedback)
          : [];
        const ids = new Set(this.state.candidates.map((candidate) => candidate.id));
        this.state.drafts = this.state.drafts.filter((draft) => ids.has(draft.candidateId));
        this.state.feedback = this.state.feedback.filter((item) => ids.has(item.candidateId));
        if (removed) this.audit('data-deleted');
        this.notice = removed
          ? `Deleted ${removed} imported session(s) and their derived candidates. Demo and observed data are unchanged.`
          : 'No imported sessions to delete.';
        this.view = 'Sessions';
        break;
      }
      case 'privacy':
        this.view = 'Privacy';
        break;
    }
  }
}
