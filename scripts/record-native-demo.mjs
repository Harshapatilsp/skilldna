import assert from 'node:assert/strict';
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve('.');
const render = join(root, 'docs/video/render');
const recording = process.argv.includes('--record');
await mkdir(render, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'skilldna-film-'));
const profile = join(temporary, 'profile');
const workspace = join(temporary, 'SampleProject');
const appdata = join(temporary, 'appdata');
await mkdir(join(profile, 'User'), { recursive: true });
await mkdir(workspace, { recursive: true });
await writeFile(join(workspace, 'example.js'), 'export const message = "Synthetic demonstration";\n');
await writeFile(join(profile, 'User/settings.json'), JSON.stringify({
  'window.dialogStyle': 'custom', 'window.titleBarStyle': 'custom',
  'workbench.startupEditor': 'none', 'workbench.colorTheme': 'Default Light Modern',
  'window.zoomLevel': 0, 'telemetry.telemetryLevel': 'off',
  'extensions.autoUpdate': false, 'update.mode': 'none',
  'chat.disableAIFeatures': true, 'workbench.tips.enabled': false,
  'security.workspace.trust.enabled': false,
}));
const fixtureFolder = join(appdata, 'Code/User/workspaceStorage', 'a'.repeat(32), 'chatSessions');
await mkdir(fixtureFolder, { recursive: true });
const fixtureBundle = join(temporary, 'fixtures.mjs');
await build({ entryPoints: [join(root, 'samples/demo.ts')], outfile: fixtureBundle, bundle: true, platform: 'node', format: 'esm' });
const { demoSessions } = await import(new URL(`file:///${fixtureBundle.replaceAll('\\', '/')}`));
await writeFile(join(fixtureFolder, 'sample.json'), JSON.stringify({ sessions: demoSessions().slice(0, 12) }));
const environment = { ...process.env, APPDATA: appdata };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: join(root, '.vscode-test/vscode-win32-arm64-archive-1.137.0/Code.exe'),
  args: [workspace, `--user-data-dir=${profile}`, `--extensions-dir=${join(temporary, 'extensions')}`,
    `--extensionDevelopmentPath=${root}`, '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-updates'],
  env: environment, timeout: 60000,
  ...(recording ? { recordVideo: { dir: render, size: { width: 1600, height: 900 } } } : {}),
});
let capture;
let elapsed;
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1600, height: 900 });
  const status = page.locator('.statusbar-item').filter({ hasText: 'SkillDNA: off' });
  await expect(status).toBeVisible({ timeout: 60000 });
  const dismiss = page.getByRole('button', { name: 'Not now', exact: true });
  if (await dismiss.count()) await dismiss.click();
  await page.evaluate(() => {
    const pointer = document.createElement('div');
    pointer.id = 'demo-pointer';
    pointer.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:24px;height:24px;border:3px solid #087f5b;background:#64ffbd77;border-radius:50%;transform:translate(-50%,-50%)';
    document.body.append(pointer);
    window.addEventListener('mousemove', event => { pointer.style.left = `${event.clientX}px`; pointer.style.top = `${event.clientY}px`; });
  });
  const start = Date.now();
  async function until(seconds) {
    if (!recording) return;
    const remaining = seconds * 1000 - (Date.now() - start);
    assert(remaining > 0, `Native actions exceeded ${seconds}s slot`);
    await page.evaluate(async duration => {
      await document.getElementById('demo-pointer').animate([{ opacity: 1 }, { opacity: 0.6 }, { opacity: 1 }], { duration }).finished;
    }, remaining);
  }
  await status.hover();
  await page.screenshot({ path: join(render, 'native-status.png') });
  await until(2);
  await status.click();
  let dashboard;
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      if (await frame.getByRole('navigation').getByRole('button', { name: 'Privacy', exact: true }).isVisible()) {
        dashboard = frame;
        return true;
      }
    }
    return false;
  }, { timeout: 30000 }).toBe(true);
  await page.screenshot({ path: join(render, 'native-dashboard.png') });
  await until(3);
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Privacy', exact: true }).click();
  const sourceChoice = dashboard.getByRole('combobox', { name: 'Data source', exact: true });
  await expect(sourceChoice.locator('option[value="metadata-only"]')).toHaveText('VS Code activity');
  await expect(sourceChoice.locator('option[value="user-imported-content"]')).toHaveText('user-imported-content');
  await sourceChoice.focus();
  await sourceChoice.press('Alt+ArrowDown');
  await page.screenshot({ path: join(render, 'native-source-choices.png') });
  await until(5);
  await sourceChoice.press('Escape');
  await sourceChoice.selectOption('user-imported-content');
  await until(6);
  await page.getByRole('button', { name: 'Enable source', exact: true }).click();
  await expect(sourceChoice).toHaveValue('user-imported-content');
  await page.screenshot({ path: join(render, 'native-source-import.png') });
  await until(8);
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Overview', exact: true }).click();
  await until(9);
  await dashboard.getByRole('button', { name: 'Import previous sessions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview Sessions', exact: true })).toBeVisible();
  await page.screenshot({ path: join(render, 'native-consent.png') });
  await until(10);
  await page.getByRole('button', { name: 'Preview Sessions', exact: true }).click();
  await until(11);
  await page.getByText('Recent workspaces', { exact: true }).click();
  await expect(page.locator('.quick-input-widget')).toContainText('1 chat');
  await page.locator('.quick-input-list .monaco-list-row').first().click();
  await until(12);
  await page.keyboard.press('Enter');
  await until(13);
  await page.getByText('10 files', { exact: true }).click();
  await expect(dashboard.getByRole('button', { name: 'Approve and discover', exact: true })).toBeVisible();
  await page.screenshot({ path: join(render, 'native-import-preview.png') });
  await until(15);
  await dashboard.getByRole('button', { name: 'Approve and discover', exact: true }).click();
  await expect(dashboard.getByRole('region', { name: 'Discovery results' })).toContainText('12 approved sessions');
  await until(17);
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Privacy', exact: true }).click();
  await until(18);
  await dashboard.getByRole('combobox', { name: 'Data source', exact: true }).selectOption('metadata-only');
  await until(19);
  await page.getByRole('button', { name: 'Enable source', exact: true }).click();
  await expect(dashboard.getByRole('button', { name: 'Pause observation', exact: true })).toBeVisible();
  await expect(page.locator('.statusbar-item').filter({ hasText: 'SkillDNA: observing' })).toBeVisible();
  await page.screenshot({ path: join(render, 'native-observation.png') });
  await until(23);
  await page.getByRole('treeitem', { name: 'example.js', exact: true }).dblclick();
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nexport const status = "reviewed";', { delay: 35 });
  await page.keyboard.press('Control+s');
  await until(27);
  await page.locator('.statusbar-item').filter({ hasText: 'SkillDNA: observing' }).click();
  await until(28);
  await dashboard.getByRole('button', { name: 'Pause observation', exact: true }).click();
  await expect(status).toBeVisible();
  await until(29);
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Sessions', exact: true }).click();
  await expect(dashboard.getByRole('region', { name: 'Observed sessions', exact: true })).toBeVisible();
  await expect(dashboard.getByRole('cell', { name: /inspect.*Recorded by source/ }).first()).toBeVisible();
  await expect(dashboard.getByRole('cell', { name: /edit.*Recorded by source/ }).first()).toBeVisible();
  await dashboard.getByRole('heading', { name: 'Observed session review', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
  await expect(dashboard.getByRole('cell', { name: /inspect.*Recorded by source/ }).first()).toBeInViewport();
  await expect(dashboard.getByRole('cell', { name: /edit.*Recorded by source/ }).first()).toBeInViewport();
  await page.screenshot({ path: join(render, 'native-observed-session.png') });
  await until(36);
  await dashboard.getByRole('button', { name: 'Approve and discover', exact: true }).click();
  await expect(dashboard.getByRole('region', { name: 'Discovery results' })).toContainText('observed');
  await until(38);
  await dashboard.getByRole('navigation').getByRole('button', { name: /^Workflows/ }).click();
  await dashboard.locator('.workflow-detail').evaluate(element => element.scrollIntoView());
  await expect(dashboard.locator('.step').first()).toBeVisible();
  await until(42);
  await dashboard.getByRole('button', { name: 'Generate skill draft', exact: true }).click();
  await expect(dashboard.getByRole('heading', { name: 'Skill review', exact: true })).toBeVisible();
  await until(43.5);
  await dashboard.getByRole('button', { name: 'Preview', exact: true }).click();
  await dashboard.locator('.file-tabs').evaluate(element => element.scrollIntoView());
  await until(48);
  await dashboard.getByRole('button', { name: 'templates/result-template.md', exact: true }).click();
  await until(51);
  await dashboard.getByRole('button', { name: 'Validate', exact: true }).click();
  await dashboard.locator('.review-approval').evaluate(element => element.scrollIntoView());
  await expect(dashboard.getByRole('heading', { name: 'errors (0)', exact: true })).toBeVisible();
  await until(54);
  await dashboard.getByRole('checkbox').check();
  await until(55);
  await dashboard.getByRole('button', { name: 'Approve draft', exact: true }).click();
  await expect(dashboard.locator('.draft-toolbar .badge')).toHaveText('approved');
  await dashboard.locator('.draft-toolbar').evaluate(element => element.scrollIntoView());
  await until(60);
  elapsed = (Date.now() - start) / 1000;
  capture = page.video();
  console.log('Verified native status, import, live observation, captured session, draft, and approval.');
} finally {
  await app.close();
}
if (recording) {
  assert(capture, 'Native recording unavailable');
  const path = join(render, 'native-walkthrough.webm');
  await capture.saveAs(path);
  await capture.delete();
  await writeFile(join(render, 'native-recording.json'), JSON.stringify({ path, elapsed }, null, 2));
  console.log(`Native recording saved: ${elapsed}s`);
}