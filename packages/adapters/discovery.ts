import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { WorkflowEvent } from '../domain';
import { ImportSource } from './import';

const workspaceHash = /^[a-f0-9]{32}$/i;
const sessionFile = /^[^/\\]+\.jsonl?$/i;
const transcriptParent = 'GitHub.copilot-chat';
const transcriptChild = 'transcripts';
const inside = (root: string, path: string) => {
  const offset = relative(root, path);
  return !isAbsolute(offset) && offset !== '..' && !offset.startsWith(`..${sep}`);
};

export async function discoverSessions(rootPath: string, selectionPaths: string[], maxFiles = 500) {
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 500)
    throw new Error('Choose a sample size between 1 and 500 files.');
  const root = resolve(rootPath);
  const rootStat = await lstat(root).catch(() => {
    throw new Error('VS Code workspace storage is unavailable. No sessions were read.');
  });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error('Discovery root must be a regular local directory.');
  const canonicalRoot = await realpath(root);
  const safe = async (path: string, directory: boolean) => {
    if (!inside(root, path)) throw new Error('Selection is outside the discovery root.');
    const parts = relative(root, path).split(sep).filter(Boolean);
    let current = root;
    for (const part of parts) {
      current = join(current, part);
      if ((await lstat(current)).isSymbolicLink())
        throw new Error('Linked files and directories are excluded from discovery.');
    }
    const stat = await lstat(path);
    if (
      !(directory ? stat.isDirectory() : stat.isFile()) ||
      !inside(canonicalRoot, await realpath(path))
    )
      throw new Error('Discovery accepts only regular files and directories inside its root.');
    return stat;
  };
  const files = new Set<string>();
  let ignored = 0;
  let skippedIdentifiers = 0;
  const addFile = (path: string) => {
    files.add(path);
    if (files.size > 20_000)
      throw new Error(
        'Discovery listing limit is 20,000 session file names. Select a workspace hash folder.',
      );
  };
  const scanFolder = async (folder: string) => {
    await safe(folder, true);
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isFile() && !entry.isSymbolicLink() && sessionFile.test(entry.name))
        addFile(join(folder, entry.name));
    }
  };
  const hasChild = async (parent: string, name: string) =>
    (await readdir(parent, { withFileTypes: true })).some(
      (entry) => entry.name === name && entry.isDirectory() && !entry.isSymbolicLink(),
    );
  const scanChats = async (workspace: string) => {
    if (!(await hasChild(workspace, 'chatSessions'))) return;
    await scanFolder(join(workspace, 'chatSessions'));
  };
  const scanTranscripts = async (workspace: string) => {
    if (!(await hasChild(workspace, transcriptParent))) return;
    const parent = join(workspace, transcriptParent);
    if (!(await hasChild(parent, transcriptChild))) return;
    await scanFolder(join(parent, transcriptChild));
  };
  const scanWorkspace = async (workspace: string) => {
    await scanChats(workspace);
    await scanTranscripts(workspace);
  };
  if (!selectionPaths.length || selectionPaths.length > 500)
    throw new Error('Select between 1 and 500 discovery paths.');
  for (const selection of selectionPaths) {
    const path = resolve(selection);
    if (!inside(root, path)) throw new Error('Selection is outside the discovery root.');
    const parts = relative(root, path).split(sep).filter(Boolean);
    if (parts.length === 0) {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.isSymbolicLink() && workspaceHash.test(entry.name)) {
          const workspace = join(root, entry.name);
          await safe(workspace, true);
          await scanWorkspace(workspace);
        }
      }
    } else if (workspaceHash.test(parts[0]) && parts.length === 1) {
      await safe(path, true);
      await scanWorkspace(join(root, parts[0]));
    } else if (workspaceHash.test(parts[0]) && parts.length === 2 && parts[1] === 'chatSessions') {
      await safe(path, true);
      await scanChats(join(root, parts[0]));
    } else if (
      workspaceHash.test(parts[0]) &&
      parts[1] === transcriptParent &&
      (parts.length === 2 || (parts.length === 3 && parts[2] === transcriptChild))
    ) {
      await safe(path, true);
      await scanTranscripts(join(root, parts[0]));
    } else if (
      parts.length === 3 &&
      workspaceHash.test(parts[0]) &&
      parts[1] === 'chatSessions' &&
      sessionFile.test(parts[2])
    ) {
      await safe(path, false);
      addFile(path);
    } else if (
      parts.length === 4 &&
      workspaceHash.test(parts[0]) &&
      parts[1] === transcriptParent &&
      parts[2] === transcriptChild &&
      sessionFile.test(parts[3])
    ) {
      await safe(path, false);
      addFile(path);
    } else
      throw new Error(
        'Select the discovery root, a workspace hash folder, its chatSessions or GitHub.copilot-chat/transcripts folder, or a direct JSON/JSONL session file.',
      );
  }
  const events: WorkflowEvent[] = [];
  const workspaces = new Set<string>();
  let bytes = 0;
  let importedFiles = 0;
  const selectedFiles = new Set([...files].map((file) => file.toLowerCase()));
  const candidates: string[] = [];
  for (const file of [...files].sort()) {
    if (file.toLowerCase().endsWith('.json') && selectedFiles.has(file.toLowerCase() + 'l')) {
      ignored++;
      continue;
    }
    candidates.push(file);
  }
  for (const file of candidates.slice(0, maxFiles)) {
    const workspace = join(root, relative(root, file).split(sep).filter(Boolean)[0]);
    if (!workspaces.has(workspace)) {
      const identifier = join(workspace, 'workspace.json');
      try {
        const stat = await safe(identifier, false);
        if (stat.size <= 64_000) JSON.parse(await readFile(identifier, 'utf8'));
        else skippedIdentifiers++;
      } catch {
        skippedIdentifiers++;
      }
      workspaces.add(workspace);
    }
    const stat = await safe(file, false);
    if (stat.size > 5_000_000) {
      ignored++;
      continue;
    }
    bytes += stat.size;
    if (bytes > 50_000_000)
      throw new Error('Discovery limit is 50 MB per scan. Select a smaller scope.');
    try {
      const parsed = await new ImportSource(
        await readFile(file, 'utf8'),
        basename(file).toLowerCase().endsWith('.jsonl'),
      ).read();
      if (events.length + parsed.length > 10_000) throw new Error('event-limit');
      events.push(...parsed);
      importedFiles++;
    } catch (error) {
      if (error instanceof Error && error.message === 'event-limit')
        throw new Error('Discovery limit is 10,000 events. Select a smaller scope.');
      ignored++;
    }
  }
  return {
    events,
    foundFiles: files.size,
    importedFiles,
    skippedFiles: ignored,
    skippedIdentifiers,
    filesNotRead: Math.max(0, candidates.length - maxFiles),
    workspaceCount: workspaces.size,
  };
}
