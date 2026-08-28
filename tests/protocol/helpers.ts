import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git } from '../../src/protocol/git.js';

export async function makeTempGitRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tower-'));
  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'tower@test.local']);
  await git(root, ['config', 'user.name', 'Tower Test']);
  // Keep default branch name stable across git versions.
  await git(root, ['checkout', '-b', 'main']);
  await writeFile(join(root, 'README.md'), '# fixture\n', 'utf8');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  await writeFile(join(root, 'src', 'b.ts'), 'export const b = 1;\n', 'utf8');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  return root;
}

export async function cleanupTemp(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

export async function commitWorktreeFile(
  repoRoot: string,
  worktreeRel: string,
  relFile: string,
  content: string,
  message: string,
): Promise<void> {
  const wt = join(repoRoot, worktreeRel);
  const abs = join(wt, relFile);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, content, 'utf8');
  await git(wt, ['add', relFile]);
  await git(wt, ['commit', '-m', message]);
}
