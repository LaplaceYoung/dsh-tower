import { TOWER_SKILL_MARKDOWN } from './skill/towerSkill.js';

/** Adapted from Kimi `tower-mode-full-reminder.md` — paths use `.dsh-tower`. */
export async function loadTowerSkillMarkdown(): Promise<string> {
  return TOWER_SKILL_MARKDOWN;
}

export function workerBriefing(input: {
  readonly name: string;
  readonly kind: 'worker' | 'reviewer';
  readonly repoRoot: string;
  readonly worktreeAbs?: string;
  readonly missionId?: string;
  readonly missionTitle?: string;
  readonly branch?: string;
  readonly scope?: readonly string[];
  readonly reviewTarget?: string;
  readonly extra?: string;
}): string {
  const lines: string[] = [
    `You are tower ${input.kind} "${input.name}".`,
    `Repository root (read-only for product code unless this is your worktree): ${input.repoRoot}`,
    '',
    'Protocol rules:',
    '- Use TowerSend / TowerInbox / TowerFinding / TowerReview / TowerMission / TowerStatus for coordination.',
    '- Never call TowerInit, TowerPlan, TowerSpawn, TowerMerge, or TowerTeardown.',
    '- Do not hand-edit files under `.dsh-tower/comms/` — tools own that tree.',
  ];

  if (input.kind === 'worker') {
    lines.push(
      '',
      `Mission: ${input.missionId ?? '?'} — ${input.missionTitle ?? ''}`,
      `Branch: ${input.branch ?? ''}`,
      `Your worktree (ABSOLUTE — all Read/Write/Edit/Bash paths must target this tree): ${input.worktreeAbs ?? ''}`,
      `Scope globs: ${(input.scope ?? []).join(', ')}`,
      '',
      'Commit on your branch inside the worktree. When done, TowerSend the tower a completion summary and request review.',
      'Out-of-scope fixes → TowerFinding or TowerSend; do not write outside your worktree (the write guard will veto).',
    );
  } else {
    lines.push(
      '',
      `Review target branch: ${input.reviewTarget ?? ''}`,
      'You are read-only: Write/Edit/str_replace_editor are denied.',
      'Inspect the branch tip, run checks if useful, then TowerReview with status clean | p1-Nitems | p2-Nitems.',
    );
  }

  if (input.extra !== undefined && input.extra.trim().length > 0) {
    lines.push('', '# Additional instructions from the tower', input.extra.trim());
  }
  return lines.join('\n');
}
