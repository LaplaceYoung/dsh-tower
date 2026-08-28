#!/usr/bin/env node
/**
 * CI smoke: verify the pinned DSH tag is fetchable and matches PINNED.md HEAD.
 * Does not install the full monorepo — shallow clone of the release tag only.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXPECTED_TAG = 'dsh-v0.1.2-alpha.1';
const EXPECTED_HEAD = 'cd5ef8148158c3a752a658978873241fdf8e2bbc';

const pinned = readFileSync(new URL('../PINNED.md', import.meta.url), 'utf8');
if (!pinned.includes(EXPECTED_TAG) || !pinned.includes(EXPECTED_HEAD)) {
  console.error('PINNED.md does not record expected DSH pin');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-tower-smoke-'));
try {
  execFileSync(
    'git',
    [
      'clone',
      '--filter=blob:none',
      '--depth',
      '1',
      '--branch',
      EXPECTED_TAG,
      'https://github.com/deepseek-ai/deepseek-harness.git',
      dir,
    ],
    { stdio: 'inherit' },
  );
  const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  if (head !== EXPECTED_HEAD) {
    console.error(`DSH HEAD mismatch: got ${head}, expected ${EXPECTED_HEAD}`);
    process.exit(1);
  }
  console.log(`smoke:dsh-pin ok ${EXPECTED_TAG} @ ${head}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
