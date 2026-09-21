import { lstat, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Draft } from '../domain';
import { validate } from './validate';
export async function exportDraft(
  workspace: string,
  draft: Draft,
  approved: boolean,
): Promise<string> {
  if (!approved || draft.status !== 'approved')
    throw new Error('Explicit approval of the exact reviewed draft is required.');
  if (validate(draft).errors.length)
    throw new Error('Resolve critical validation errors before exporting.');
  let directory = workspace;
  const root = await lstat(directory);
  if (root.isSymbolicLink() || !root.isDirectory())
    throw new Error('Workspace must be a real local directory.');
  for (const part of ['.github', 'skills']) {
    directory = join(directory, part);
    try {
      await mkdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error('Symlink or non-directory export destination rejected.');
  }
  const target = join(directory, draft.name);
  await mkdir(target);
  try {
    for (const [relative, contents] of Object.entries(draft.files)) {
      const parts = relative.split('/');
      parts.pop();
      if (parts.length) await mkdir(join(target, ...parts), { recursive: true });
      await writeFile(join(target, relative), contents, { flag: 'wx' });
    }
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
  return target;
}
