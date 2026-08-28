import { join } from 'node:path';

import type { ToolExecution } from '@deepseek-ai/dsh-tools';

import { TowerStore, WORKTREES_DIR, resolveTowerRepoRoot } from '../protocol/index.js';
import {
  WRITE_TOOL_NAMES,
  absPath,
  protocolAgentId,
  sessionCwd,
} from './runtime.js';

function extractWritePath(args: unknown): string | undefined {
  if (args === null || typeof args !== 'object') return undefined;
  const record = args as Record<string, unknown>;
  for (const key of ['file_path', 'path']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

function isPathInside(path: string, root: string): boolean {
  const normalizedPath = path.replaceAll('\\', '/');
  const normalizedRoot = root.replaceAll('\\', '/').replace(/\/+$/, '');
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

interface RosterCache {
  readonly repoRoot: string;
  readonly agents: ReadonlyArray<{ readonly agentId: string; readonly worktree?: string }>;
  readonly loadedAt: number;
}

const rosterCache = new Map<string, RosterCache>();

/** Call after spawn/init/teardown and periodically from tools so the sync guard stays warm. */
export async function refreshRosterCache(repoRoot: string): Promise<void> {
  try {
    const store = new TowerStore(repoRoot);
    if (!(await store.isInitialized())) {
      rosterCache.delete(repoRoot);
      return;
    }
    const state = await store.load();
    rosterCache.set(repoRoot, {
      repoRoot,
      agents: state.roster.agents.map((a) => ({
        agentId: a.agentId,
        worktree: a.worktree,
      })),
      loadedAt: Date.now(),
    });
  } catch {
    // fail open
  }
}

/**
 * Sync monotonic guard (`ctx.tools.guard`). Uses a short-lived roster cache
 * refreshed by tower tool execute paths and the async pre-execute hook.
 */
export function towerWriteGuard(execution: Readonly<ToolExecution>): string | undefined {
  if (!WRITE_TOOL_NAMES.has(execution.name)) return undefined;
  const agent = execution.agent;
  if (agent === undefined) return undefined;
  const agentId = protocolAgentId(agent);
  if (agentId === 'main') return undefined;

  const cwd = sessionCwd(agent);
  const repoRoot = resolveTowerRepoRoot(cwd);
  const cached = rosterCache.get(repoRoot);
  if (cached === undefined) return undefined;

  const entry = cached.agents.find((a) => a.agentId === agentId);
  if (entry?.worktree === undefined) return undefined;

  const filePath = extractWritePath(execution.arguments);
  if (filePath === undefined) return undefined;

  const worktreeAbs = join(cached.repoRoot, WORKTREES_DIR, entry.worktree);
  const target = absPath(cwd, filePath);
  if (isPathInside(target, worktreeAbs)) return undefined;

  return (
    `tower workers may only write inside their own worktree (${worktreeAbs}) — denied: ${target}. ` +
    'Out-of-scope changes are not yours to make: file them with TowerFinding or ask the tower via TowerSend.'
  );
}

/** Prefer this when wiring `tools/pre-execute` waterfall (async, authoritative). */
export async function towerWritePreExecute(
  execution: Readonly<ToolExecution>,
): Promise<{ kind: 'deny'; reason: string } | undefined> {
  if (!WRITE_TOOL_NAMES.has(execution.name)) return undefined;
  const agent = execution.agent;
  if (agent === undefined) return undefined;
  const agentId = protocolAgentId(agent);
  if (agentId === 'main') return undefined;

  const cwd = sessionCwd(agent);
  const repoRoot = resolveTowerRepoRoot(cwd);
  await refreshRosterCache(repoRoot);

  const filePath = extractWritePath(execution.arguments);
  if (filePath === undefined) return undefined;

  try {
    const store = new TowerStore(repoRoot);
    if (!(await store.isInitialized())) return undefined;
    const state = await store.load();
    const entry = state.roster.agents.find((a) => a.agentId === agentId);
    if (entry?.worktree === undefined) return undefined;
    const worktreeAbs = store.abs(join(WORKTREES_DIR, entry.worktree));
    const target = absPath(cwd, filePath);
    if (isPathInside(target, worktreeAbs)) return undefined;
    return {
      kind: 'deny',
      reason:
        `tower workers may only write inside their own worktree (${worktreeAbs}) — denied: ${target}. ` +
        'Out-of-scope changes are not yours to make: file them with TowerFinding or ask the tower via TowerSend.',
    };
  } catch {
    return undefined;
  }
}
