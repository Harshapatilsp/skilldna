import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyState, type State } from '../domain';
export interface Repository {
  load(): Promise<State>;
  save(state: State): Promise<void>;
  clear(): Promise<void>;
}
export class JsonRepository implements Repository {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly directory: string) {}
  async load(): Promise<State> {
    try {
      const state = JSON.parse(await readFile(join(this.directory, 'state.json'), 'utf8')) as State;
      if (
        state.schemaVersion !== 1 ||
        !Array.isArray(state.sessions) ||
        !state.consent ||
        !state.settings
      )
        throw new Error('Unsupported storage schema. Use Delete All Data to reset.');
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
      throw error;
    }
  }
  save(state: State): Promise<void> {
    const contents = JSON.stringify(state);
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory, { recursive: true });
        await writeFile(join(this.directory, 'state.tmp'), contents, {
          mode: 0o600,
        });
        await rename(join(this.directory, 'state.tmp'), join(this.directory, 'state.json'));
      });
    return this.queue;
  }
  async clear() {
    await this.queue.catch(() => {});
    await rm(join(this.directory, 'state.json'), { force: true });
    await rm(join(this.directory, 'state.tmp'), { force: true });
  }
}
