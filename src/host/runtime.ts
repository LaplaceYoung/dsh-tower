import { isAbsolute, resolve } from 'node:path';

import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';

import {
  GitError,
  TowerProtocolError,
  TowerStore,
  resolveTowerRepoRoot,
} from '../protocol/index.js';

/** Map a DSH agent to the protocol caller id (`main` for top-level tower). */
export function protocolAgentId(agent: Agent | undefined): string {
  if (agent === undefined) return 'main';
  if (agent.session.header.parentSession === undefined) return 'main';
  return String(agent.id);
}

export function sessionCwd(agent: Agent | undefined): string {
  const cwd = agent?.session.header.cwd;
  if (cwd !== undefined && cwd.trim().length > 0) return cwd;
  return process.cwd();
}

export function sessionIdOf(agent: Agent | undefined): string | undefined {
  return agent !== undefined ? String(agent.session.id) : undefined;
}

export function storeFor(agent: Agent | undefined): TowerStore {
  return new TowerStore(resolveTowerRepoRoot(sessionCwd(agent)));
}

export function storeFromExec(exec: Pick<ToolRunContext, 'agent'>): TowerStore {
  return storeFor(exec.agent);
}

export async function runTower<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof TowerProtocolError || error instanceof GitError) {
      throw new Error(error.message);
    }
    throw error;
  }
}

export function absPath(cwd: string, filePath: string): string {
  return isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath);
}

export const TOWER_MAIN_AGENT_ONLY =
  'Tower orchestration tools are only supported by the main (tower) agent.';

export const TOWER_MAIN_ONLY_TOOLS = [
  'TowerInit',
  'TowerPlan',
  'TowerSpawn',
  'TowerMerge',
  'TowerTeardown',
] as const;

export const TOWER_SHARED_TOOLS = [
  'TowerSend',
  'TowerInbox',
  'TowerFinding',
  'TowerReview',
  'TowerMission',
  'TowerStatus',
] as const;

export const TOWER_ALL_TOOLS = [...TOWER_MAIN_ONLY_TOOLS, ...TOWER_SHARED_TOOLS] as const;

export const WRITE_TOOL_NAMES = new Set(['write', 'edit', 'str_replace_editor']);
