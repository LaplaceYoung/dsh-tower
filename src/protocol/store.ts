import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import picomatch from 'picomatch';

import { parseFrontmatter, renderFrontmatter } from './frontmatter.js';
import {
  branchExists,
  branchTip,
  currentBranch,
  diffNameOnly,
  hasAnyCommit,
  isInsideRepo,
  isWorktreeDirty,
  mergeNoFf,
  tryGit,
  worktreeAdd,
  worktreeRemove,
} from './git.js';
import {
  ACTIVITY_LOG,
  BROADCAST_NAME,
  FINDINGS_DIR,
  INBOX_DIR,
  LOG_DIR,
  MISSIONS_DIR,
  MISSIONS_INDEX,
  REVIEWS_DIR,
  STATE_FILE,
  TOWER_NAME,
  WORKTREES_DIR,
  dateDash,
  findingFileName,
  inboxFileName,
  missionFileName,
  reviewFileName,
  slugify,
  targetSlug,
} from './paths.js';
import type {
  TowerFindingSeverity,
  TowerFindingType,
  TowerInboxItem,
  TowerMission,
  TowerMissionKind,
  TowerMissionStatus,
  TowerReviewInfo,
  TowerRosterEntry,
  TowerState,
} from './types.js';

export class TowerProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TowerProtocolError';
  }
}

export interface TowerInitResult {
  readonly base: string;
  readonly created: boolean;
  readonly retiredAgents: readonly string[];
  readonly checkout: string;
  readonly ignoredBase?: string;
  readonly openMissions: readonly string[];
}

export interface TowerPlanInput {
  readonly title: string;
  readonly scope: readonly string[];
  readonly tasks?: readonly string[];
  readonly deps?: readonly string[];
  readonly kind?: TowerMissionKind;
}

export interface TowerSendInput {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly scope?: string;
  readonly action?: string;
  readonly consentRef?: string;
}

export interface TowerFindingInput {
  readonly type: TowerFindingType;
  readonly title: string;
  readonly severity?: TowerFindingSeverity;
  readonly summary: string;
  readonly location?: string;
  readonly details: string;
  readonly suggestedFix: string;
}

export interface TowerReviewInput {
  readonly target: string;
  readonly status: string;
  readonly merge: string;
  readonly findings: string;
  readonly checks?: readonly string[];
  readonly decision: string;
}

export interface TowerMissionPatch {
  readonly status?: TowerMissionStatus;
  readonly note?: string;
  readonly blocker?: string;
  readonly clearBlockers?: boolean;
  readonly taskDone?: string;
  readonly owner?: string;
  readonly scope?: readonly string[];
}

const FINDING_TYPES: readonly TowerFindingType[] = ['bug', 'improve', 'vuln', 'idea'];
const STATUS_EMOJI: Record<TowerMissionStatus, string> = {
  planned: '🟡',
  active: '🔵',
  completed: '🟢',
  blocked: '🔴',
  paused: '⏸️',
  merged: '✅',
  abandoned: '🚫',
};

function isOpenMission(mission: Pick<TowerMission, 'status'>): boolean {
  return mission.status !== 'merged' && mission.status !== 'abandoned';
}

export class TowerStore {
  constructor(readonly repoRoot: string) {}

  async isInitialized(): Promise<boolean> {
    try {
      await readFile(this.abs(STATE_FILE), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  async init(sessionId?: string, base?: string): Promise<TowerInitResult> {
    if (!(await isInsideRepo(this.repoRoot))) {
      throw new TowerProtocolError(
        'tower needs a git repository (the session working directory is not inside one)',
      );
    }
    if (!(await hasAnyCommit(this.repoRoot))) {
      throw new TowerProtocolError(
        'the repository has no commits yet — create an initial commit first',
      );
    }
    // dsh-tower divergence from Kimi (#3346): never init / open on a dirty base.
    if (await isWorktreeDirty(this.repoRoot)) {
      throw new TowerProtocolError(
        'tower refuses to init on a dirty working tree — commit or stash changes first (dsh-tower will not silently use HEAD while WIP exists)',
      );
    }
    if (await this.isInitialized()) {
      const state = await this.load();
      const retiredAgents = await this.adoptForeignRoster(state, sessionId);
      return {
        base: state.base,
        created: false,
        retiredAgents,
        checkout: await this.checkedOutBranch(),
        ignoredBase: base !== undefined && base !== state.base ? base : undefined,
        openMissions: state.missions.filter(isOpenMission).map((m) => m.id),
      };
    }

    const checkout = await this.checkedOutBranch();
    if (checkout === 'HEAD') {
      throw new TowerProtocolError(
        'cannot determine the base branch from a detached HEAD — check out a branch first',
      );
    }
    // P3: arbitrary base branch (#3193). First release only allows current HEAD.
    if (base !== undefined && base !== checkout) {
      throw new TowerProtocolError(
        `specifying a base branch other than the current HEAD is not supported yet (requested "${base}", checkout is "${checkout}")`,
      );
    }
    const resolvedBase = checkout;

    for (const dir of [INBOX_DIR, FINDINGS_DIR, REVIEWS_DIR, MISSIONS_DIR, LOG_DIR, WORKTREES_DIR]) {
      await mkdir(this.abs(dir), { recursive: true });
    }
    await this.ensureGitExclude();

    const state: TowerState = {
      version: 1,
      base: resolvedBase,
      mode: 'branch',
      createdAt: new Date().toISOString(),
      sessionId,
      roster: { agents: [] },
      missions: [],
    };
    await this.save(state);
    await writeFile(this.abs(ACTIVITY_LOG), '', 'utf8');
    await this.renderMissionsIndex(state);
    await this.appendLog(TOWER_NAME, 'init', { mode: state.mode, base: resolvedBase }, MISSIONS_INDEX);
    return { base: resolvedBase, created: true, retiredAgents: [], checkout, openMissions: [] };
  }

  private async checkedOutBranch(): Promise<string> {
    return (await tryGit(this.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])) ?? 'HEAD';
  }

  private async adoptForeignRoster(
    state: TowerState,
    sessionId: string | undefined,
  ): Promise<readonly string[]> {
    if (sessionId === undefined || state.sessionId === sessionId) return [];
    const previous = state.sessionId;
    const stale = state.roster.agents.filter((agent) => agent.sessionId !== sessionId);
    state.roster.agents.splice(
      0,
      state.roster.agents.length,
      ...state.roster.agents.filter((agent) => agent.sessionId === sessionId),
    );
    state.sessionId = sessionId;
    await this.save(state);
    await this.appendLog(TOWER_NAME, 'adopt', {
      session: sessionId,
      previous: previous ?? 'unknown',
      retired: stale.length > 0 ? stale.map((agent) => agent.name).join(',') : undefined,
    });
    return stale.map((agent) => agent.name);
  }

  private async ensureGitExclude(): Promise<void> {
    const gitDir = (await readGitDir(this.repoRoot)) ?? join(this.repoRoot, '.git');
    const excludePath = join(gitDir, 'info', 'exclude');
    await mkdir(dirname(excludePath), { recursive: true });
    let existing = '';
    try {
      existing = await readFile(excludePath, 'utf8');
    } catch {
    }
    if (existing.split(/\r?\n/).some((line) => line.trim() === '.dsh-tower/')) return;
    await appendFile(excludePath, `${existing.endsWith('\n') || existing.length === 0 ? '' : '\n'}.dsh-tower/\n`, 'utf8');
  }

  async load(): Promise<TowerState> {
    let raw: string;
    try {
      raw = await readFile(this.abs(STATE_FILE), 'utf8');
    } catch {
      throw new TowerProtocolError(
        'tower is not initialized in this repository — run TowerInit first',
      );
    }
    const state = JSON.parse(raw) as TowerState;
    for (const mission of state.missions) {
      mission.kind ??= 'build';
    }
    return state;
  }

  private async save(state: TowerState): Promise<void> {
    const file = this.abs(STATE_FILE);
    const tmp = `${file}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(tmp, file);
  }

  async appendLog(
    actor: string,
    action: string,
    details: Readonly<Record<string, string | number | undefined>> = {},
    ref?: string,
  ): Promise<void> {
    const kv = Object.entries(details)
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    const parts = [new Date().toISOString(), actor, action];
    if (kv.length > 0) parts.push(kv);
    if (ref !== undefined) parts.push(`ref=${ref}`);
    await appendFile(this.abs(ACTIVITY_LOG), `${parts.join(' ')}\n`, 'utf8');
  }

  async recentLog(lines: number): Promise<readonly string[]> {
    let content = '';
    try {
      content = await readFile(this.abs(ACTIVITY_LOG), 'utf8');
    } catch {
      return [];
    }
    const all = content.split('\n').filter((line) => line.trim().length > 0);
    return all.slice(-lines);
  }

  resolveCallerName(state: TowerState, agentId: string): string {
    if (agentId === 'main') return TOWER_NAME;
    const entry = state.roster.agents.find((agent) => agent.agentId === agentId);
    if (entry === undefined) {
      throw new TowerProtocolError(
        `agent "${agentId}" is not a tower participant — only spawned workers/reviewers and the tower can use tower tools`,
      );
    }
    return entry.name;
  }

  findAgent(state: TowerState, name: string): TowerRosterEntry | undefined {
    return state.roster.agents.find((agent) => agent.name === name);
  }

  findByName(state: TowerState, name: string): TowerRosterEntry | undefined {
    return this.findAgent(state, name);
  }

  async registerAgent(entry: TowerRosterEntry): Promise<void> {
    const state = await this.load();
    if (this.findAgent(state, entry.name) !== undefined) {
      throw new TowerProtocolError(`tower agent name "${entry.name}" is already registered`);
    }
    state.roster.agents.push(entry);
    await this.save(state);
  }

  async plan(input: readonly TowerPlanInput[]): Promise<readonly TowerMission[]> {
    if (input.length === 0) {
      throw new TowerProtocolError('TowerPlan needs at least one mission');
    }
    const state = await this.load();
    const startIndex = state.missions.length;

    const missions: TowerMission[] = input.map((item, index) => {
      const n = startIndex + index + 1;
      const slug = slugify(item.title, 40);
      return {
        id: `M${n}`,
        title: item.title,
        slug,
        kind: item.kind ?? 'build',
        scope: [...item.scope],
        branch: `feat/${slug}`,
        worktree: `wt-${n}`,
        deps: item.deps ?? [],
        status: 'planned',
        tasks: (item.tasks ?? []).map((text) => ({ text, done: false })),
        notes: [],
        blockers: [],
      };
    });

    const knownIds = new Set([...state.missions.map((m) => m.id), ...missions.map((m) => m.id)]);
    for (const mission of missions) {
      for (const dep of mission.deps) {
        if (!knownIds.has(dep)) {
          throw new TowerProtocolError(`mission ${mission.id} depends on unknown mission "${dep}"`);
        }
      }
    }
    this.assertScopesDisjoint([
      ...state.missions.filter(isOpenMission),
      ...missions,
    ]);

    state.missions.push(...missions);
    await this.save(state);
    await this.renderMissionsIndex(state);
    for (const mission of missions) {
      await this.renderMissionFile(mission);
    }
    await this.appendLog(
      TOWER_NAME,
      'plan',
      { missions: missions.map((m) => m.id).join(',') },
      MISSIONS_INDEX,
    );
    return missions;
  }

  private assertScopesDisjoint(missions: readonly TowerMission[]): void {
    const scopes: Array<{ readonly id: string; readonly raw: string; readonly stem: string }> = [];
    for (const mission of missions) {
      if (mission.kind === 'survey') continue;
      for (const raw of mission.scope) {
        const stem = raw.replace(/\/\*\*?$/, '').replace(/\*$/, '').replace(/\/+$/, '');
        if (stem.length === 0) {
