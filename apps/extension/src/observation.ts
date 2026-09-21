import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type {
  Action,
  Consent,
  InteractionSource,
  Resource,
  WorkflowEvent,
} from '../../../packages/domain';
import { fileCategory, normalize } from '../../../packages/privacy';
export class MetadataSource implements InteractionSource {
  readonly type = 'metadata' as const;
  private queue: WorkflowEvent[] = [];
  constructor(
    private readonly consent: () => Consent,
    private readonly deliver: (event: WorkflowEvent) => void,
  ) {}
  async read() {
    return this.queue.splice(0);
  }
  capture(action: Action, resource: Resource, tool: WorkflowEvent['tool']) {
    if (
      this.consent().mode !== 'metadata-only' ||
      this.consent().paused ||
      !vscode.workspace.isTrusted
    )
      return;
    const event = normalize(
      { action, resource, tool },
      {
        source: this.type,
        mode: 'metadata-only',
        sessionId: 'observation',
        id: randomUUID(),
      },
    );
    this.deliver(event);
  }
  register(): vscode.Disposable[] {
    const approvedFile = (uri: vscode.Uri) =>
      uri.scheme === 'file' && !!vscode.workspace.getWorkspaceFolder(uri);
    return [
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (approvedFile(document.uri))
          this.capture('inspect', fileCategory(document.uri.fsPath), 'editor');
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (approvedFile(document.uri))
          this.capture('edit', fileCategory(document.uri.fsPath), 'editor');
      }),
      vscode.workspace.onDidCreateFiles((event) => {
        for (const uri of event.files)
          if (approvedFile(uri)) this.capture('edit', fileCategory(uri.fsPath), 'editor');
      }),
      vscode.tasks.onDidStartTask((event) =>
        this.capture(
          event.execution.task.group === vscode.TaskGroup.Test ? 'validate' : 'execute',
          event.execution.task.group === vscode.TaskGroup.Test ? 'test' : 'unknown',
          'task',
        ),
      ),
      vscode.debug.onDidStartDebugSession(() => this.capture('analyze', 'source-code', 'debug')),
      vscode.debug.onDidTerminateDebugSession(() => this.capture('review', 'source-code', 'debug')),
    ];
  }
}
