/** Worker / reviewer tool filters aligned with Kimi `tower-worker` profile. */

const MAIN_ONLY_DENY = [
  'TowerInit',
  'TowerPlan',
  'TowerSpawn',
  'TowerMerge',
  'TowerTeardown',
  'swarm_batch',
  'TeamSpawn',
  'TeamMessage',
] as const;

/** Workers cannot ask the human; escalate via TowerSend. */
const WORKER_EXTRA_DENY = ['AskUserQuestion', 'TodoList', 'todo_list', 'todo'] as const;

const REVIEWER_WRITE_DENY = ['write', 'edit', 'str_replace_editor'] as const;

export function workerToolDeny(): string[] {
  return [...MAIN_ONLY_DENY, ...WORKER_EXTRA_DENY];
}

export function reviewerToolDeny(): string[] {
  return [...MAIN_ONLY_DENY, ...WORKER_EXTRA_DENY, ...REVIEWER_WRITE_DENY];
}

/** Tools denied for the main agent while tower mode is active. */
export const TOWER_MODE_MAIN_DENY = new Set(['TodoList', 'todo_list', 'todo']);
