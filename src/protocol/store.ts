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
