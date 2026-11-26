// Settings, sign-in and sign-out update the same account dotenv. A Windows
// rename can yield while a reader holds the file open, so queue the read as
// well as the write. Each caller then edits the previous caller's result.
import * as fs from 'fs';
import * as path from 'path';
import { writeEnvFileAtomic } from './private-files';

const pending = new Map<string, Promise<void>>();

export async function updateEnvFile(
  envPath: string,
  transform: (existing: string | null) => string | null,
): Promise<void> {
  const key = path.resolve(envPath);
  const previous = pending.get(key);
  const run = async () => {
    let existing: string | null;
    try {
      existing = fs.readFileSync(key, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      existing = null;
    }
    const content = transform(existing);
    if (content !== null) await writeEnvFileAtomic(key, content);
  };
  const current = previous ? previous.then(run, run) : run();
  pending.set(key, current);
  try {
    await current;
  } finally {
    if (pending.get(key) === current) pending.delete(key);
  }
}
