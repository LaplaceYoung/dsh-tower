# dsh-tower

DeepSeek Harness community plugin that ports **Kimi Code Tower** onto DSH plugin seams (`ctx.tools` / `ctx.commands` / `ctx.subagents` / `tools/pre-execute` / `systemPrompt`).

> Tower = main agent as control tower; workers build in **isolated git worktrees**; merge only after **clean review** and protocol hard gates.

中文：[README.zh.md](./README.zh.md)

## Pins

See [`PINNED.md`](./PINNED.md).

| Upstream | Pin |
|---|---|
| Kimi Code Tower | `@moonshot-ai/kimi-code@0.39.1` (`5efca0c3…`) → `packages/agent-core-v2/src/features/tower/` (identical on `main`) |
| DeepSeek Harness | `dsh-v0.1.2-alpha.1` (`cd5ef814…`) |
| Cordis peer | `@deepseek-ai/cordis@^4.0.1` |

Published npm peers track the closest public cut (`0.1.1-rc.2`); runtime compatibility target is **`dsh@0.1.2-alpha.1`**.

## Install

### From a DSH source checkout (recommended)

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git checkout dsh-v0.1.2-alpha.1
pnpm install && pnpm run build

pnpm dsh plugin --profile web add github:LaplaceYoung/dsh-tower
# or: pnpm dsh plugin --profile web add /absolute/path/to/dsh-tower

export DSH_EXPERIMENTAL_TOWER=1
pnpm dsh web --no-open
```

Or set plugin config `experimental: true` in the profile `cordis.patch.yml`. **Default is off.**

```text
/tower on
/tower <objective>
/tower status
/tower teardown
```

## What it is / is not

| Is | Is not |
|---|---|
| Isolated worktree per mission + review gate + merge gate | Swarm (fan-out/gather, shared workspace) |
| `.dsh-tower/comms/state.json` as sole mutable truth | Official `agent-team` mailbox |
| Continuable workers via `startContinuable` | `dsh-worktree` human preview handoff |

## Protocol invariants

1. `.dsh-tower/comms/state.json` is the only mutable truth.
2. `MISSIONS.md` / `missions/*.md` are generated — do not hand-edit.
3. One worktree + mutually exclusive scope per mission.
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

No custom DSH session vocabulary events — progress via tool returns and `.dsh-tower/comms/log/activity.log`.

## Develop

```bash
npm install
npm test
npm run build
npm run smoke:dsh-pin
```

## Sources

- Tower root: https://github.com/MoonshotAI/kimi-code/tree/master/packages/agent-core-v2/src/features/tower
- `TowerStore`: https://github.com/MoonshotAI/kimi-code/blob/master/packages/agent-core-v2/src/features/tower/protocol/store.ts
- Mode reminder: https://github.com/MoonshotAI/kimi-code/blob/master/packages/agent-core-v2/src/features/tower/injection/tower-mode-full-reminder.md
- DSH tools: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/docs/user/develop/basic/tool.md
- Continuable subagents: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/packages/subagent/subagent/src/continuation.ts

## Layout

```
src/protocol/   # zero Cordis — portable TowerStore
src/host/       # DSH apply(), tools, /tower, spawn, write guard, native seams
tests/protocol/
tests/host/
```

Does not vendor or fork `deepseek-harness`.
