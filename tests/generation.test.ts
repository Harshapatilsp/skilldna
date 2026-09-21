import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { demoSessions } from '../samples/demo';
import { SequenceMiner } from '../packages/workflow-engine';
import { generate, sections } from '../packages/skill-generator';
import { validate } from '../packages/skill-generator/validate';
import { exportDraft } from '../packages/skill-generator/export';
const candidate = new SequenceMiner().mine(demoSessions())[0];
const draft = generate(candidate, '2026-09-14');
describe('skill generation and validation', () => {
  it('preserves combination uncertainty in generated artifacts', () => {
    const combined = generate({ ...candidate, combinedFrom: ['first', 'second'] }, '2026-09-16');
    expect(combined.files['SKILL.md']).toContain('not a verified end-to-end procedure');
    expect(combined.files['SKILL.md']).toContain('not combined executions');
    expect(combined.files['SKILL.md']).toContain(
      'do not execute all optional branches in sequence',
    );
    expect(validate(combined).errors).toEqual([]);
  });
  it('generates deterministic complete safe artifacts', () => {
    expect(generate(candidate, '2026-09-14')).toEqual(draft);
    expect(draft.name).toBe('evidence-based-case-investigation');
    for (const section of sections) expect(draft.files['SKILL.md']).toContain(`## ${section}`);
    expect(validate(draft).errors).toEqual([]);
    expect(validate(draft).warnings).toEqual([]);
  });
  it('does not leak normalized examples or imported text', () => {
    expect(JSON.stringify(draft)).not.toContain('analyst@example');
    expect(JSON.stringify(draft)).not.toContain('synthetic-only');
    expect(draft.files['SKILL.md']).toContain('Synthetic example only');
    expect(draft.files['SKILL.md']).toContain('Observed in 6 of 12');
  });
  it.each([
    'password=hidden',
    'C:\\Users\\private\\secret.txt',
    '[bad](missing.md)',
    'user@example.com',
  ])('blocks %s', (unsafe) => {
    expect(
      validate({
        ...draft,
        files: {
          ...draft.files,
          'SKILL.md': draft.files['SKILL.md'] + '\n' + unsafe,
        },
      }).errors.length,
    ).toBeGreaterThan(0);
  });
  it('blocks invalid name, frontmatter, files and references', () => {
    expect(validate({ name: '../bad', files: {} }).errors.length).toBeGreaterThan(0);
    expect(
      validate({ ...draft, files: { 'SKILL.md': 'no frontmatter' } }).errors.length,
    ).toBeGreaterThan(0);
    expect(validate({ ...draft, files: { ...draft.files, '../bad': '' } }).errors).toContain(
      'Unsafe supporting file path.',
    );
  });
  it('reports missing safety and validation as warnings', () => {
    const markdown = draft.files['SKILL.md']
      .replace('## Safety and privacy', '## Removed')
      .replace('## Validation', '## Removed');
    expect(
      validate({ ...draft, files: { ...draft.files, 'SKILL.md': markdown } }).warnings,
    ).toContain('Missing section: Validation.');
  });
  it('loads demo, mines, generates, validates, exports and verifies files', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'skilldna-export-'));
    try {
      await expect(exportDraft(folder, draft, false)).rejects.toThrow('approval');
      const approved = { ...draft, status: 'approved' as const };
      const target = await exportDraft(folder, approved, true);
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe(draft.files['SKILL.md']);
      await expect(exportDraft(folder, approved, true)).rejects.toThrow();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
  it('rejects symlink destinations', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'skilldna-link-'));
    const outside = await mkdtemp(join(tmpdir(), 'skilldna-outside-'));
    try {
      await mkdir(join(folder, '.github'));
      await symlink(outside, join(folder, '.github', 'skills'), 'junction');
      await expect(exportDraft(folder, { ...draft, status: 'approved' }, true)).rejects.toThrow(
        'Symlink',
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
