import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyState } from '../packages/domain';
import { JsonRepository } from '../packages/storage';
describe('foundation', () => {
  it('defaults to no observation', () => {
    expect(emptyState().consent).toMatchObject({ mode: 'off', paused: true });
  });
  it('round trips and deletes local state', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'skilldna-'));
    try {
      const repo = new JsonRepository(folder);
      expect(await repo.load()).toEqual(emptyState());
      await repo.save(emptyState());
      expect(await repo.load()).toEqual(emptyState());
      await repo.clear();
      expect(await repo.load()).toEqual(emptyState());
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
