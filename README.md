# dsh-tower — Kimi Code Tower for DeepSeek Harness

**dsh-tower** is a community [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin that ports the [Kimi Code Tower](https://github.com/MoonshotAI/kimi-code/tree/master/packages/agent-core-v2/src/features/tower) protocol onto native DSH plugin seams.

The main agent becomes a **control tower**. Worker agents implement missions in **isolated git worktrees**. A reviewer agent must pass a **clean review**. Merge happens only after **protocol hard gates**.

[English](./README.md) · [中文](./README.zh.md)

> **Experimental and default-off.** Installing the plugin does not put `Tower*` tools into the default toolset. Enable with `DSH_EXPERIMENTAL_TOWER=1` or `experimental: true` in the profile `cordis.patch.yml`.

## Why this exists

Several AI coding agents on one repo fight over the same working tree: overwritten files, dirty `git status`, and merges that cannot be reviewed independently.

Tower separates three concerns that a plain subagent fan-out does not:

| Layer | What it guarantees |
|---|---|
| **Isolation** | One git worktree + mutually exclusive file scope per mission |
| **Communication** | Inbox / findings / reviews as atomic files; `.dsh-tower/comms/state.json` is the only mutable truth |
| **Gates** | Review must be clean, tip unchanged since review, deps merged, three-dot diff inside scope, not detached HEAD |

It is **not** a swarm (fan-out/gather on a shared workspace) and **not** DSH official `agent-team`.

## Who it is for

- DSH users who want Kimi Code's `/tower` workflow without leaving DeepSeek Harness
- Plugin authors studying how to mount a multi-agent protocol on `ctx.tools` / `ctx.commands` / `ctx.subagents` / `tools/pre-execute` / `systemPrompt`
- Teams that need parallel agent work on disjoint paths, with a review-gated merge back to `main`

Skip this plugin if you want shared-workspace swarming, human worktree preview (`dsh-worktree`), or official `agent-team` mailboxes.

## Quick start

Requires a DSH source checkout at tag **`dsh-v0.1.2-alpha.1`** (runtime compatibility target).

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git checkout dsh-v0.1.2-alpha.1
pnpm install && pnpm run build

pnpm dsh plugin --profile web add github:LaplaceYoung/dsh-tower
# or a local checkout:
# pnpm dsh plugin --profile web add /absolute/path/to/dsh-tower

export DSH_EXPERIMENTAL_TOWER=1
pnpm dsh web --no-open
```

Then, in the DSH session:

```text
/tower on
/tower <objective>
/tower status
/tower teardown
```

## How Tower runs

```text
user objective
    |
    v
control tower (main agent)
    |  splits into missions with exclusive scopes
    v
worker -- isolated git worktree --> reviewer (read-only)
    |
    v
TowerMerge hard gates --> main
    |
    v
/tower teardown  (keeps dirty worktrees)
```

- Workers are spawned with `ctx.subagents.startContinuable` (never `start()`), so a mission can resume.
- Reviewers cannot `write` / `edit` / `str_replace_editor`.
- Workers cannot write the primary checkout; `ctx.tools.guard` + `tools/pre-execute` veto out-of-worktree writes.
- Progress is tool return values plus `.dsh-tower/comms/log/activity.log`. No custom DSH session events.

## What it is / is not

| Is | Is not |
|---|---|
| Isolated worktree per mission + review gate + merge gate | Swarm (fan-out/gather, shared workspace) |
| `.dsh-tower/comms/state.json` as sole mutable truth | Official `agent-team` mailbox |
| Continuable workers via `startContinuable` | `dsh-worktree` human preview handoff |

## Protocol invariants

1. `.dsh-tower/comms/state.json` is the only mutable truth.
2. `MISSIONS.md` / `missions/*.md` are generated — do not hand-edit.
3. One worktree + mutually exclusive file scope per mission.
4. Inbox / findings / reviews use frontmatter + atomic create.
5. `TowerMerge` hard gates: clean review, tip unchanged since review, deps merged, three-dot diff within scope, not detached HEAD.
6. New session adopt retires old roster; keeps missions + worktrees.
7. Dirty base: **refused** on init / worktree create (does not copy Kimi #3346 silent HEAD behaviour).
8. Reviewers are read-only (`write` / `edit` / `str_replace_editor` denied).

## DSH native seams used

| Seam | Use |
|---|---|
| `ctx.tools.register` + `defineTool` | 11 `Tower*` tools |
| `ctx.tools.guard` | Sync write veto for workers |
| `ctx.on('tools/pre-execute')` | Async authoritative out-of-worktree deny |
| `ctx.commands.register` | `/tower`; steers the full operating manual |
| `ctx.subagents.startContinuable` | Workers/reviewers (never `start()`) |
| `ctx.on('subagent/end')` | Release inflight spawn slots |
| `ctx.systemPrompt.section` | Optional model announcement (`announceToAgent`) |

Does not vendor or fork `deepseek-harness`.

## Compatibility pins

See [`PINNED.md`](./PINNED.md). Last pin check: 2026-08-28.

| Upstream | Pin |
|---|---|
| Kimi Code Tower | `@moonshot-ai/kimi-code@0.39.1` (`5efca0c3…`) → `packages/agent-core-v2/src/features/tower/` (identical on `main`) |
| DeepSeek Harness | `dsh-v0.1.2-alpha.1` (`cd5ef814…`) |
| Cordis peer | `@deepseek-ai/cordis@^4.0.1` |

Published npm peers track the closest public cut (`0.1.1-rc.2`); runtime compatibility target is **`dsh@0.1.2-alpha.1`**.

## Develop

```bash
npm install
npm test          # protocol + host unit tests; full DSH not required
npm run build
npm run smoke:dsh-pin
```

Live check against the pinned DSH tag:

```bash
pnpm dsh plugin --profile web add /path/to/dsh-tower
DSH_EXPERIMENTAL_TOWER=1 pnpm dsh web --port 3080 --no-open
```

## Layout

```
src/protocol/   # zero Cordis — portable TowerStore
src/host/       # DSH apply(), tools, /tower, spawn, write guard, native seams
tests/protocol/
tests/host/
```

## FAQ

### What is dsh-tower?

A DeepSeek Harness community plugin that ports Kimi Code Tower: the main agent orchestrates missions, workers code in isolated git worktrees, reviewers stay read-only, and merges pass hard protocol gates.

### How do I enable Kimi Tower inside DeepSeek Harness?

Install the plugin into a DSH `web` profile pinned at `dsh-v0.1.2-alpha.1`, then set `DSH_EXPERIMENTAL_TOWER=1` (or `experimental: true` in `cordis.patch.yml`) and run `/tower on`.

### How is Tower different from swarm or DSH agent-team?

Swarm shares a workspace and fans work out then in. Official `agent-team` uses a mailbox. Tower gives each mission its own worktree and scope, then blocks merge until review and protocol checks pass.

### Does this fork DeepSeek Harness or Kimi Code?

No. Protocol logic lives in `src/protocol/`. The host only registers on documented DSH seams. Upstream trees are pinned, not vendored.

### Why is it default-off?

Tower registers 11 tools, write guards, and a `/tower` operating manual. The plugin stays dark until you opt in, so a normal DSH session is unchanged.

### What blocks a merge?

No clean review, tip moved after review, unmerged dependencies, files outside the mission scope, or a detached HEAD.

## Sources

- Tower root: https://github.com/MoonshotAI/kimi-code/tree/master/packages/agent-core-v2/src/features/tower
- `TowerStore`: https://github.com/MoonshotAI/kimi-code/blob/master/packages/agent-core-v2/src/features/tower/protocol/store.ts
- Mode reminder: https://github.com/MoonshotAI/kimi-code/blob/master/packages/agent-core-v2/src/features/tower/injection/tower-mode-full-reminder.md
- DSH tools: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/docs/user/develop/basic/tool.md
- Continuable subagents: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/packages/subagent/subagent/src/continuation.ts

## License

MIT. See [LICENSE](./LICENSE).
