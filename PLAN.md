# Cordis-native Tower — gap plan

Authoritative sources: Kimi `packages/agent-core-v2/src/features/tower/` @ pin;
DSH Cordis docs + `agent-team` / `plan-mode` / `tool-agent-team` @ `dsh-v0.1.2-alpha.1`.

## Goal

Fully Cordis-nativize **host** while preserving Kimi Tower capabilities that work on kimicode.
`src/protocol/` stays zero-Cordis. Invariants (`.dsh-tower`, dirty-base refuse, merge gates,
`startContinuable`, experimental off, reviewers read-only) do not change.

## Gap matrix

| Area | Kimi / DSH idiom | dsh-tower before | Target |
|------|------------------|------------------|--------|
| Config | `@deepseek-ai/schemastery` | npm `schemastery` (devOnly) | `@deepseek-ai/schemastery` dependency |
| Mode service | `IAgentTowerService` enter/exit/isActive | prompt steer only | `ctx.tower` Service |
| Rate limit | app-scoped service | local `TowerRateLimit` | owned by `ctx.tower` |
| Injection | full / sparse / exit | full only via `/tower on` | full + sparse + exit (`.dsh-tower`) |
| `declare module` | `Context.tower` | none | yes |
| `ctx.effect` | fiber cleanup | module-global roster cache | service-owned + effect clear |
| Worker profile | deny AskUserQuestion; no orchestration | orchestration deny + reviewer writes | + AskUserQuestion / TodoList |
| TodoList in mode | code-denied | skill text only | `tools/pre-execute` when mode active |
| systemPrompt | typed soft inject | cast/`try` | `ctx.get('systemPrompt')` |
| Nested enable | feature unit flag | early-return in apply | keep early-return; service only when on |

## Non-goals

- Rewrite protocol merge/init; rename `.dsh-tower`; custom session events; `start()`; silent dirty-base; vendoring DSH.

## Execution order

1. Packaging + PLAN (this file)
2. `TowerService` + injection texts + mode enter/exit
3. Retarget tools/command/spawn/guard/native to `ctx.tower`
4. Profile deny lists + TodoList veto in mode
5. Tests / mount smoke / README EN+ZH
