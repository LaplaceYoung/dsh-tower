# dsh-tower acceptance checklist

Evidence gathered in this agent run (2026-08-28).

## Pins

- [x] `PINNED.md` records kimi tag/hash and dsh tag/hash
- [x] Kimi `@moonshot-ai/kimi-code@0.39.1` @ `5efca0c3116743855c28426000073bfe34a4862f`
- [x] DSH `dsh-v0.1.2-alpha.1` @ `cd5ef8148158c3a752a658978873241fdf8e2bbc`
- [x] No newer tower commits on kimi `main` vs tag (tree hash identical)
- [x] Dirty-base init/open refused (divergence from Kimi `#3346`)

## P0 protocol

- [x] Protocol tests run without installing DSH — `npm test` → 11/11 protocol cases green
- [x] Non-git `init` fails
- [x] Dirty working tree `init` fails
- [x] Overlapping scope `plan` rejected
- [x] Unknown deps `plan` rejected
- [x] Inbox private vs `to=all` visibility
- [x] Merge rejection matrix (no review → p2 → clean → tip moved → re-review → merge)
- [x] Unmerged deps blocked
- [x] Out-of-scope files blocked
- [x] Survey merge is noop
- [x] Teardown keeps dirty worktree
- [x] Second `init` (new session) retires roster, keeps missions

## P1 host

- [x] Default-off: `isTowerEnabled({})` false without env/config
- [x] 11 `Tower*` tools registered in host when enabled (`TOWER_ALL_TOOLS`)
- [x] `/tower` command + skill adapted from `tower-mode-full-reminder.md` (`.dsh-tower`)
- [x] Spawn uses `ctx.subagents.startContinuable` (unit-tested with mock)
- [x] Spawn failure rolls back worktree and leaves no ghost owner
- [x] Reviewer `toolFilter` denies `write` / `edit` / `str_replace_editor`
- [x] Write guard vetoes worker writes outside own worktree
- [x] Inflight rate-limit cap (default 8)
- [x] No custom DSH session vocabulary events (activity.log + tool returns only)
- [x] Dual-mission scripted merge: two disjoint scopes → clean reviews → both land on main → teardown removes worktrees
- [x] Native seams wired: `systemPrompt.section`, `tools/pre-execute`, `subagent/end`
- [x] `defineTool` nested object schemas include `additionalProperties` (DSH web requirement)
- [x] Cordis-native `ctx.tower` Service (`enter` / `exit` / `isActive`, rate-limit, roster cache)
- [x] Config via `@deepseek-ai/schemastery` (runtime dependency)
- [x] Mode injection full / sparse / exit (`.dsh-tower` adapted)
- [x] `/tower off` exits mode; TodoList denied while mode active
- [x] Worker profile denies `AskUserQuestion` + `TodoList`
- [x] Mount smoke proves `ctx.tower` + 11 tools + listeners (`scripts/verify-host-mount.mjs`)
- [x] `npm test` → 26 green (protocol + host)

## Packaging

- [x] Independent npm plugin (`name: dsh-tower`, `main` set)
- [x] README cites Kimi 0.39.1 + DSH 0.1.2-alpha.1 source links
- [x] `README.zh.md` Chinese install / seams guide added
- [x] Does not fork/vendor `deepseek-harness`
- [x] `cordis.patch.yml` mounts plugin with `experimental: false`

## Notes

- Verified against locally built `dsh-v0.1.2-alpha.1` web on `:3080`.
- Plugin loads via `dsh plugin --profile web add` (path or `github:LaplaceYoung/dsh-tower`).
- `defineTool` schema needs `additionalProperties` on nested objects for DSH web validation.
- Native seams: `systemPrompt`, `tools/pre-execute`, `subagent/end`.
- `README.zh.md` added.
- Full live dual-mission with real LLM workers was not run end-to-end; protocol merge path + host spawn/guard/native unit tests cover the gates and seams.
- Published npm peers are `0.1.1-rc.2` (closest public cut); runtime pin remains `dsh-v0.1.2-alpha.1`.
