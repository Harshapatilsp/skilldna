import { build } from 'esbuild';
import { runTests } from '@vscode/test-electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const temporary = await mkdtemp(join(tmpdir(), 'skilldna-host-'));
try {
  await build({ entryPoints: ['tests/host/index.ts'], outfile: 'dist/host-tests.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['vscode'] });
  await runTests({ extensionDevelopmentPath: resolve('.'), extensionTestsPath: resolve('dist/host-tests.cjs'), ...(process.env.VSCODE_EXECUTABLE ? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE } : {}), launchArgs: [temporary, '--user-data-dir=' + join(temporary, 'profile'), '--extensions-dir=' + join(temporary, 'extensions'), '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'] });
} finally { await rm(temporary, { recursive: true, force: true }); }