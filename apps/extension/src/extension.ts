import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { Application } from '../../../packages/application';
import { messageSchema, type Message } from '../../../packages/domain/protocol';
import type { WorkflowEvent } from '../../../packages/domain';
import { JsonRepository } from '../../../packages/storage';
import { discoverSessions } from '../../../packages/adapters/discovery';
import { segment } from '../../../packages/workflow-engine/sessions';
import {
  CopilotReviewQueue,
  reviewInstructions,
} from '../../../packages/workflow-engine/copilot-review';
import { validate } from '../../../packages/skill-generator/validate';
import { exportDraft } from '../../../packages/skill-generator/export';
import { MetadataSource } from './observation';
import { Dashboard } from './dashboard';

const expandPath = (value: string) =>
  value
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/%APPDATA%/gi, () => process.env.APPDATA ?? '');

async function countSessionFiles(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile() && /\.jsonl?$/i.test(entry.name)).length;
}

async function listRecentWorkspaces(root: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const hashes = entries.filter(
    (entry) => entry.isDirectory() && !entry.isSymbolicLink() && /^[a-f0-9]{32}$/i.test(entry.name),
  );
  const rows = await Promise.all(
    hashes.map(async (entry) => {
      const fsPath = join(root, entry.name);
      const chat = await countSessionFiles(join(fsPath, 'chatSessions'));
      const transcripts = await countSessionFiles(
        join(fsPath, 'GitHub.copilot-chat', 'transcripts'),
      );
      const info = await stat(fsPath).catch(() => undefined);
      return { fsPath, hash: entry.name, chat, transcripts, modified: info?.mtimeMs ?? 0 };
    }),
  );
  return rows
    .filter((row) => row.chat + row.transcripts > 0)
    .sort((left, right) => right.modified - left.modified)
    .slice(0, 50);
}

export async function activate(context: vscode.ExtensionContext) {
  const repository = new JsonRepository((context.storageUri ?? context.globalStorageUri).fsPath);
  let storageBlocked = false;
  const app = new Application();
  try {
    app.state = await repository.load();
    app.expire();
  } catch {
    storageBlocked = true;
    void vscode.window.showWarningMessage(
      'SkillDNA storage is unreadable or unsupported. Delete All Data to reset; existing data has not been overwritten.',
    );
  }
  app.state.consent.paused = true;
  if (app.state.consent.mode === 'skilldna-interactions') app.state.consent.mode = 'off';
  app.notice = 'Observation is paused on activation. Resume an approved source explicitly.';
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  status.command = 'skilldna.openDashboard';
  status.show();
  context.subscriptions.push(status);
  const copilot = new CopilotReviewQueue(() => update(true));
  context.subscriptions.push({ dispose: () => copilot.clear() });
  const update = (preserveView = false) => {
    status.text = `$(shield) SkillDNA: ${app.state.consent.paused ? 'off' : 'observing'}`;
    status.tooltip = `${copilot.state.enabled ? 'Copilot summary review enabled' : 'Local analysis'} | ${app.state.consent.mode}`;
    dashboard.update({
      ...app.snapshot(),
      copilot: copilot.state,
      ...(preserveView ? { view: undefined } : {}),
    });
  };
  let queue: Promise<void> = Promise.resolve();
  const route = (input: unknown) => {
    queue = queue
      .catch(() => {})
      .then(async () => {
        const parsed = messageSchema.safeParse(input);
        if (!parsed.success) throw new Error('Unsupported or malformed dashboard message.');
        if (storageBlocked && !['deleteAll', 'ready', 'privacy'].includes(parsed.data.type))
          throw new Error('Reset unreadable storage with Delete All Data first.');
        const previousCandidates = app.state.candidates;
        await dispatch(parsed.data);
        if (!storageBlocked && parsed.data.type !== 'deleteAll' && parsed.data.type !== 'ready')
          await repository.save(app.state);
        update();
        if (app.state.candidates !== previousCandidates) {
          if (
            ['analyze', 'approveSessions', 'importPrevious', 'import', 'discoverDemo'].includes(
              parsed.data.type,
            )
          ) {
            void copilot.schedule(app.state.candidates, app.state.sessions);
          } else {
            copilot.clear();
            update(true);
          }
        }
      })
      .catch((error) => {
        const message =
          error instanceof Error && !('code' in error)
            ? error.message
            : 'Local operation failed. Check destination permissions; existing files are never overwritten.';
        dashboard.error(message);
        void vscode.window.showWarningMessage(`SkillDNA: ${message}`);
      });
    return queue;
  };
  const dashboard = new Dashboard(context, (input) => {
    void route(input);
  });
  let observationId = randomUUID();
  let lastObservation = 0;
  const capture = (event: WorkflowEvent) => {
    if (
      storageBlocked ||
      app.pending.reduce((sum, session) => sum + session.events.length, 0) >= 200
    )
      return;
    const now = Date.now();
    if (now - lastObservation > app.state.settings.idleMinutes * 60_000)
      observationId = randomUUID();
    lastObservation = now;
    let session = app.pending.find(
      (item) => item.id === observationId && item.source === event.source,
    );
    if (!session) {
      session = {
        schemaVersion: 1,
        id: observationId,
        source: event.source,
        events: [],
        reason: 'Explicit start, source, or idle boundary',
        approved: false,
        synthetic: false,
        createdAt: event.timestamp,
      };
      app.pending.push(session);
    }
    session.events.push({
      ...event,
      sessionId: session.id,
      predecessorId: session.events.at(-1)?.id,
    });
    app.notice =
      'Approved-source metadata is pending in memory. Review Sessions before analysis or persistence.';
    update();
  };
  const metadata = new MetadataSource(() => app.state.consent, capture);
  context.subscriptions.push(...metadata.register());
  async function dispatch(message: Message) {
    if (message.type === 'copilotConsent') {
      app.view = 'Privacy';
      if (!message.enabled) {
        copilot.disable();
        app.audit('consent-changed');
        return;
      }
      if (!vscode.workspace.isTrusted)
        throw new Error('Trust this workspace before enabling Copilot review.');
      const approval = await vscode.window.showWarningMessage(
        'Allow Copilot to review workflow suitability?',
        {
          modal: true,
          detail:
            'This is not local-only. Approved session summaries (action, intent and resource categories, occurrence rates, outcome counts, and local recommendations) will be sent to your selected Copilot model provider. No raw chats, file contents, paths, names, timestamps or session identifiers are sent. Requests consume your model quota. Up to 10 candidates are reviewed after explicit analysis; unchanged results are cached in memory. Permission and results last only for this window session. Disable in Privacy to cancel pending requests; already transmitted data cannot be recalled. Recommendations remain advisory and never execute actions or approve exports.',
        },
        'Enable Copilot review',
      );
      if (approval !== 'Enable Copilot review') return;
      try {
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        if (!models.length) {
          app.notice =
            'AI review unavailable: no Copilot models are accessible. Local analysis remains available.';
          return;
        }
        const selected = await vscode.window.showQuickPick(
          models.map((model) => ({ label: model.name, description: model.id, model })),
          { title: 'Choose a Copilot model for advisory workflow review' },
        );
        if (!selected) return;
        const model = selected.model;
        copilot.enable(model.name, async (summary, signal) => {
          if (!vscode.workspace.isTrusted || signal.aborted)
            throw new Error('Review not authorized.');
          const cancellation = new vscode.CancellationTokenSource();
          const cancel = () => cancellation.cancel();
          signal.addEventListener('abort', cancel, { once: true });
          try {
            const messages = [
              vscode.LanguageModelChatMessage.User(reviewInstructions),
              vscode.LanguageModelChatMessage.User(summary),
            ];
            let tokens = 0;
            for (const prompt of messages)
              tokens += await model.countTokens(prompt, cancellation.token);
            if (tokens > Math.min(4000, model.maxInputTokens - 1500))
              throw new Error('Review exceeds token budget.');
            const response = await model.sendRequest(messages, {}, cancellation.token);
            let text = '';
            for await (const fragment of response.text) {
              if (signal.aborted) throw new Error('Review cancelled.');
              text += fragment;
              if (text.length > 8000) throw new Error('Review response too large.');
            }
            return text;
          } finally {
            signal.removeEventListener('abort', cancel);
            cancellation.cancel();
            cancellation.dispose();
          }
        });
        app.audit('consent-changed');
        app.notice =
          'Copilot summary review enabled for this window. Local evidence and export approval are unchanged.';
        void copilot.schedule(app.state.candidates, app.state.sessions);
      } catch {
        copilot.disable();
        app.notice =
          'AI review unavailable: model access was denied or failed. Local analysis remains available.';
      }
      return;
    }
    if (message.type === 'importPrevious' || message.type === 'import') {
      if (!vscode.workspace.isTrusted)
        throw new Error('Trust this workspace before importing previous sessions.');
      if (app.pending.length) {
        app.view = 'Sessions';
        app.notice = 'Review or discard the current pending sessions before importing more.';
        return;
      }
      if (!process.env.APPDATA || process.platform !== 'win32')
        throw new Error(
          'Scoped Copilot discovery currently requires Windows VS Code workspace storage.',
        );
      const root = join(process.env.APPDATA, 'Code', 'User', 'workspaceStorage');
      const approval = await vscode.window.showInformationMessage(
        'Analyze my previous Copilot sessions',
        {
          modal: true,
          detail:
            "SkillDNA will locally scan the selected scope in VS Code's workspace storage for Copilot session files to identify repeated workflows.\n\nSkillDNA will read: workspace identifiers, Copilot chat sessions, and Copilot transcripts only (<hash>/workspace.json, <hash>/chatSessions/*.json or *.jsonl, and <hash>/GitHub.copilot-chat/transcripts/*.json or *.jsonl).\n\nSkillDNA will not: modify session files, read state databases, extension state, unrelated caches, chatEditingSessions, or other workspace files, or upload raw conversations.\n\nPreview Sessions keeps normalized results in memory. Analyze also asks for approval of the discovered sessions before saving and analyzing. Unsupported formats are skipped and reported.",
        },
        'Preview Sessions',
        'Analyze',
        'Cancel',
      );
      if (approval !== 'Preview Sessions' && approval !== 'Analyze') return;
      const scope = await vscode.window.showQuickPick(
        [
          {
            label: '$(history) Recent workspaces',
            description: 'Pick recent Copilot workspaces by date (recommended)',
            mode: 'recent' as const,
          },
          {
            label: '$(folder-opened) Browse folders',
            description: 'Select workspace, chatSessions, or transcripts folders',
            mode: 'browse' as const,
          },
          {
            label: '$(edit) Enter a folder path',
            description: 'Paste a workspaceStorage, chatSessions, or transcripts path',
            mode: 'path' as const,
          },
          {
            label: '$(file) Pick specific files',
            description: 'Choose individual .json or .jsonl session files',
            mode: 'files' as const,
          },
        ],
        {
          title: 'Import previous Copilot sessions — choose a source',
          matchOnDescription: true,
        },
      );
      if (!scope) return;
      let selected: vscode.Uri[] | undefined;
      if (scope.mode === 'recent') {
        const workspaces = await listRecentWorkspaces(root);
        if (!workspaces.length) {
          vscode.window.showInformationMessage(
            'No Copilot chat sessions or transcripts were found in VS Code workspace storage.',
          );
          return;
        }
        const picks = await vscode.window.showQuickPick(
          workspaces.map((workspace) => ({
            label: `$(folder) ${workspace.hash.slice(0, 8)}…`,
            description: `${workspace.chat} chat · ${workspace.transcripts} transcripts`,
            detail: `Modified ${new Date(workspace.modified).toLocaleString()}`,
            uri: vscode.Uri.file(workspace.fsPath),
          })),
          {
            title: 'Select one or more workspaces to scan (chat sessions and transcripts)',
            canPickMany: true,
            matchOnDescription: true,
            ignoreFocusOut: true,
          },
        );
        if (!picks?.length) return;
        selected = picks.map((pick) => pick.uri);
      } else if (scope.mode === 'path') {
        const folder = await vscode.window.showInputBox({
          title: 'Folder containing previous Copilot sessions',
          value: root,
          prompt:
            'Use workspaceStorage, a workspace hash folder, its chatSessions folder, or its GitHub.copilot-chat/transcripts folder. Only the discovery allowlist is read.',
          ignoreFocusOut: true,
          validateInput: (value) => (value.trim() ? undefined : 'Enter a folder path.'),
        });
        if (folder === undefined) return;
        selected = [vscode.Uri.file(expandPath(folder))];
      } else {
        const folders = scope.mode === 'browse';
        selected = await vscode.window.showOpenDialog({
          defaultUri: vscode.Uri.file(root + '/'),
          canSelectFolders: folders,
          canSelectFiles: !folders,
          canSelectMany: true,
          filters: folders ? undefined : { 'Copilot sessions': ['json', 'jsonl'] },
          title: folders
            ? 'Select workspace, chatSessions, or transcripts folders'
            : 'Select .json or .jsonl session files',
          openLabel: approval,
        });
      }
      if (!selected?.length) return;
      if (scope.mode === 'browse' || scope.mode === 'path') {
        while (selected.length < 500) {
          const next = await vscode.window.showQuickPick(
            ['Continue with selected folders', 'Add another folder path'],
            {
              title: `${selected.length} folder(s) selected`,
              placeHolder: 'Add folder paths when the native dialog supports only one folder.',
            },
          );
          if (!next) return;
          if (next === 'Continue with selected folders') break;
          const folder = await vscode.window.showInputBox({
            title: 'Add a workspace, chatSessions, or transcripts folder',
            value: root,
            ignoreFocusOut: true,
            validateInput: (value) => (value.trim() ? undefined : 'Enter a folder path.'),
          });
          if (folder === undefined) return;
          const uri = vscode.Uri.file(expandPath(folder));
          if (!selected.some((item) => item.fsPath.toLowerCase() === uri.fsPath.toLowerCase()))
            selected.push(uri);
        }
      }
      if (scope.mode === 'browse' || scope.mode === 'path') {
        const confirmed = await vscode.window.showQuickPick(
          selected.map((uri) => ({
            label: uri.fsPath,
            picked: true,
            uri,
          })),
          { title: 'Confirm folders to scan', canPickMany: true, ignoreFocusOut: true },
        );
        if (!confirmed?.length) return;
        selected = confirmed.map((item) => item.uri);
      }
      if (selected.some((uri) => uri.scheme !== 'file'))
        throw new Error('Discovery requires local files.');
      const sample = await vscode.window.showQuickPick(
        [
          { label: '10 files', description: 'Small first preview (recommended)', limit: 10 },
          { label: '5 files', description: 'Minimal sample', limit: 5 },
          { label: '25 files', description: 'Larger sample', limit: 25 },
          {
            label: 'Up to 500 files',
            description: 'Full selected scope within scan limits',
            limit: 500,
          },
        ],
        {
          title: 'How many session files should SkillDNA read?',
          placeHolder: 'Samples use filename order, not recency; other session files are not read.',
        },
      );
      if (!sample) return;
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Discovering previous Copilot sessions',
        },
        () =>
          discoverSessions(
            root,
            selected.map((uri) => uri.fsPath),
            sample.limit,
          ),
      );
      const pending = segment(
        result.events.map((event) => ({ event })),
        app.state.settings.idleMinutes,
      );
      if (pending.length > 500 || pending.some((session) => session.events.length > 200))
        throw new Error('Select a smaller scope: maximum 500 sessions with 200 events each.');
      app.handle({ type: 'consent', mode: 'user-imported-content' });
      app.audit('import-started');
      app.pending = pending;
      app.view = 'Sessions';
      const summary = `Found ${result.foundFiles} session files; inspected ${result.workspaceCount} workspace identifiers and loaded ${pending.length} normalized sessions from ${result.importedFiles} files. Left ${result.filesNotRead} files unread due to the sample limit. Skipped ${result.skippedFiles} duplicate, unreadable, oversized, or unsupported files and ${result.skippedIdentifiers} unavailable workspace identifiers.`;
      app.notice = pending.length
        ? `${summary} Nothing has been saved. Review before approval.`
        : `${summary} No supported sessions were loaded. Select a different workspace folder or sample. JSONL session logs are supported, but unknown structures cannot be analyzed.`;
      if (approval === 'Analyze' && pending.length) {
        update();
        const confirmed = await vscode.window.showWarningMessage(
          `Approve and analyze ${pending.length} discovered sessions?`,
          {
            modal: true,
            detail: `${summary}\n\nOnly normalized categories will be saved locally. Choose Preview Sessions to review or exclude individual sessions first.`,
          },
          'Approve and analyze',
          'Preview Sessions',
          'Cancel',
        );
        if (confirmed === 'Approve and analyze') {
          app.handle({
            type: 'approveSessions',
            ids: pending.map((session) => session.id),
            analyze: true,
          });
          app.notice = `${summary} ${app.notice}`;
        } else if (confirmed !== 'Preview Sessions') app.handle({ type: 'discardPending' });
      }
      return;
    }
    if (message.type === 'consent' && !['off', 'demo-only'].includes(message.mode)) {
      if (!vscode.workspace.isTrusted)
        throw new Error('Trust this workspace before enabling user-data sources.');
      const approval = await vscode.window.showWarningMessage(
        `Enable ${message.mode}? SkillDNA retains only normalized categories. Imported text may be analyzed locally after redaction; raw bodies are discarded. Observations remain pending until reviewed. Copilot summary review has a separate opt-in in Privacy.`,
        { modal: true },
        'Enable source',
      );
      if (approval !== 'Enable source') return;
    }
    if (message.type === 'resume' && !vscode.workspace.isTrusted)
      throw new Error('Observation requires a trusted workspace.');
    if (message.type === 'startSession') {
      observationId = randomUUID();
      lastObservation = Date.now();
      app.notice = 'New observation session boundary set. Source consent is unchanged.';
      return;
    }
    if (message.type === 'stopSession') {
      observationId = randomUUID();
      app.handle({ type: 'pause' });
      return;
    }
    if (message.type === 'export') {
      if (!vscode.workspace.isTrusted)
        throw new Error('Skill export requires a trusted workspace.');
      const draft = app.state.drafts.find((item) => item.id === message.id);
      if (!draft || draft.status !== 'approved')
        throw new Error('Review all files and approve the saved draft before exporting.');
      app.validation = validate(draft);
      if (app.validation.errors.length) throw new Error('Critical validation errors block export.');
      const folders =
        vscode.workspace.workspaceFolders?.filter((folder) => folder.uri.scheme === 'file') ?? [];
      if (!folders.length)
        throw new Error('Open a local workspace folder as the skill destination.');
      const folder =
        folders.length === 1
          ? folders[0]
          : (
              await vscode.window.showQuickPick(
                folders.map((item) => ({ label: item.name, folder: item })),
                { title: 'Choose skill destination workspace' },
              )
            )?.folder;
      if (!folder) return;
      const destination = vscode.Uri.joinPath(folder.uri, '.github', 'skills', draft.name);
      const approval = await vscode.window.showWarningMessage(
        `Export the reviewed skill to ${destination.fsPath}? Files: ${Object.keys(draft.files).join(', ')}. ${app.validation.warnings.length} warnings. No scripts will run. Existing directories are never overwritten.`,
        { modal: true },
        'Export reviewed skill',
      );
      if (approval !== 'Export reviewed skill') return;
      await exportDraft(folder.uri.fsPath, structuredClone(draft), true);
      draft.status = 'exported';
      app.audit('skill-exported');
      app.notice = 'Reviewed skill exported. No scripts or sample requests were executed.';
      await vscode.window.showTextDocument(vscode.Uri.joinPath(destination, 'SKILL.md'), {
        preview: false,
      });
      return;
    }
    if (message.type === 'exportData') {
      const target = await vscode.window.showSaveDialog({
        title: 'Export normalized SkillDNA data and reviewed drafts',
        defaultUri: vscode.Uri.joinPath(
          context.storageUri ?? context.globalStorageUri,
          'skilldna-export.json',
        ),
        filters: { JSON: ['json'] },
      });
      if (target) {
        await vscode.workspace.fs.writeFile(
          target,
          new TextEncoder().encode(JSON.stringify(app.state, null, 2)),
        );
        app.notice =
          'SkillDNA data exported to the explicitly selected file. Pending sessions were excluded.';
      }
      return;
    }
    if (message.type === 'deleteAll') {
      if (
        (await vscode.window.showWarningMessage(
          'Delete all stored SkillDNA sessions, candidates, drafts, consent, feedback, and audit records? Exported files remain unchanged.',
          { modal: true },
          'Delete all data',
        )) !== 'Delete all data'
      )
        return;
      await repository.clear();
      storageBlocked = false;
      copilot.disable();
      app.handle(message);
      return;
    }
    app.handle(message);
    if (['consent', 'resume', 'pause'].includes(message.type)) observationId = randomUUID();
  }
  const commands: Record<string, Message['type']> = {
    openDashboard: 'ready',
    startObservation: 'privacy',
    pauseObservation: 'pause',
    resumeObservation: 'resume',
    importSessions: 'importPrevious',
    loadDemoData: 'demo',
    analyzeWorkflows: 'analyze',
    showSkillCandidates: 'analyze',
    generateSkillDraft: 'generate',
    validateSkill: 'validate',
    exportSkill: 'export',
    openPrivacyCenter: 'privacy',
    viewConsentSettings: 'privacy',
    exportMyData: 'exportData',
    deleteAllData: 'deleteAll',
    startSession: 'startSession',
    stopSession: 'stopSession',
  };
  for (const [command, type] of Object.entries(commands))
    context.subscriptions.push(
      vscode.commands.registerCommand(`skilldna.${command}`, async () => {
        dashboard.open();
        if (['generate', 'validate', 'export'].includes(type)) {
          const items = type === 'generate' ? app.state.candidates : app.state.drafts;
          const picked = await vscode.window.showQuickPick(
            items.map((item) => ({ label: item.name, id: item.id })),
            {
              title:
                type === 'generate' ? 'Review a workflow before drafting' : 'Select a skill draft',
            },
          );
          if (picked) await route({ type, id: picked.id });
          else update();
        } else await route({ type });
      }),
    );
  const provider: vscode.TreeDataProvider<vscode.TreeItem> = {
    getTreeItem: (item) => item,
    getChildren: () =>
      [
        ['Open Dashboard', 'openDashboard', 'dashboard'],
        ['Load Synthetic Demo', 'loadDemoData', 'play'],
        ['Analyze Workflows', 'analyzeWorkflows', 'git-merge'],
        ['Privacy Center', 'openPrivacyCenter', 'shield'],
      ].map(([title, command, icon]) => {
        const item = new vscode.TreeItem(title);
        item.command = { command: `skilldna.${command}`, title };
        item.iconPath = new vscode.ThemeIcon(icon);
        return item;
      }),
  };
  context.subscriptions.push(vscode.window.registerTreeDataProvider('skilldna.home', provider));
  if (vscode.chat?.createChatParticipant) {
    const participant = vscode.chat.createChatParticipant(
      'skilldna.assistant',
      async (request, _chatContext, stream) => {
        stream.markdown('SkillDNA does not record this chat interaction.\n\n');
        if (request.command === 'explain') {
          const candidate = app.state.candidates[0];
          stream.markdown(
            candidate
              ? candidate.explanation.join('\n\n')
              : 'No candidates yet. Load data and analyze first.',
          );
        } else if (request.command === 'candidates') {
          stream.markdown(
            app.state.candidates
              .map(
                (candidate) =>
                  `- **${candidate.name}**: ${candidate.recommendation}, ${candidate.occurrences} sessions`,
              )
              .join('\n') || 'No candidates yet.',
          );
        } else {
          dashboard.open();
          if (request.command === 'generate' && app.state.candidates[0])
            await route({ type: 'generate', id: app.state.candidates[0].id });
          else if (request.command === 'validate' && app.state.drafts.at(-1))
            await route({ type: 'validate', id: app.state.drafts.at(-1)!.id });
          else if (request.command === 'analyze') await route({ type: 'analyze' });
          else update();
          stream.markdown(
            'Review results in the SkillDNA dashboard. Only approved normalized sessions are analyzed.',
          );
        }
        return {};
      },
    );
    participant.iconPath = new vscode.ThemeIcon('git-branch');
    context.subscriptions.push(participant);
  }
  update();
  if (
    context.extensionMode !== vscode.ExtensionMode.Test &&
    !context.globalState.get<boolean>('onboardingShown')
  ) {
    await context.globalState.update('onboardingShown', true);
    if (!storageBlocked && !app.state.sessions.length) {
      void vscode.window
        .showInformationMessage(
          'Welcome to SkillDNA. Discover reusable workflows from your previous sessions. No data is read without your consent.',
          'Import previous sessions',
          'Try synthetic demo',
          'Not now',
        )
        .then((choice) => {
          if (choice === 'Import previous sessions' || choice === 'Try synthetic demo') {
            dashboard.open();
            return route({
              type: choice === 'Import previous sessions' ? 'importPrevious' : 'discoverDemo',
            });
          }
        });
    }
  }
  return {
    getSnapshot: () => structuredClone({ ...app.snapshot(), copilot: copilot.state }),
    analyzeDemoForTest: async () => {
      await route({ type: 'demo' });
      await route({ type: 'analyze' });
      return structuredClone(app.snapshot());
    },
  };
}
