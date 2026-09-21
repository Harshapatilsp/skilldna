import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import type { Snapshot } from '../../packages/domain/protocol';
export async function run() {
  const extension = vscode.extensions.getExtension<{ getSnapshot(): Snapshot }>(
    'skilldna-local.skilldna',
  );
  assert.ok(extension, 'SkillDNA extension is installed in the test host');
  const api = await extension.activate();
  assert.equal(api.getSnapshot().state.consent.mode, 'off');
  assert.equal(api.getSnapshot().state.sessions.length, 0);
  assert.equal(api.getSnapshot().copilot?.enabled, false);
  assert.deepEqual(api.getSnapshot().copilot?.reviews, {});
  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    'openDashboard',
    'loadDemoData',
    'importSessions',
    'analyzeWorkflows',
    'generateSkillDraft',
    'validateSkill',
    'exportSkill',
    'deleteAllData',
  ])
    assert.ok(commands.includes(`skilldna.${command}`));
  await vscode.commands.executeCommand('skilldna.loadDemoData');
  assert.equal(api.getSnapshot().state.sessions.length, 25);
  await vscode.commands.executeCommand('skilldna.analyzeWorkflows');
  assert.equal(api.getSnapshot().state.candidates.length, 3);
  assert.equal(api.getSnapshot().state.candidates[0].recommendation, 'Create skill');
  assert.equal(api.getSnapshot().state.consent.paused, true);
  assert.equal(api.getSnapshot().copilot?.enabled, false);
  assert.deepEqual(api.getSnapshot().copilot?.reviews, {});
  console.log(
    'SkillDNA extension-host checks passed: activation, default-off, commands, demo, mining.',
  );
}
