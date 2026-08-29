# Pin check (2026-08-28, Asia/Singapore)

Pin check run as step 0 before any implementation. Default branch on MoonshotAI/kimi-code is `main` (not `master`).

## Kimi Code (Tower host)

| Field | Value |
|---|---|
| Requested tag | `@moonshot-ai/kimi-code@0.39.1` |
| Exact tag | `@moonshot-ai/kimi-code@0.39.1` |
| HEAD | `5efca0c3116743855c28426000073bfe34a4862f` |
| Tag date | 2026-08-28 17:58:47 +0800 |
| Latest GitHub release | `@moonshot-ai/kimi-code@0.39.1` (no newer tag) |
| Tower tree at tag | `837d6fc082ec63c3bebe61dc6bf688d9c8854de0` |
| Tower tree at `origin/main` | `837d6fc082ec63c3bebe61dc6bf688d9c8854de0` (identical) |
| Commits on `origin/main` since tag touching `packages/agent-core-v2/src/features/tower` | **none** |

Authoritative source used for the port:

```
packages/agent-core-v2/src/features/tower/
```

Note: tag `@moonshot-ai/kimi-code@0.4.0` exists but is older (2026-05-27), not a successor of 0.39.x.

## DeepSeek Harness (mount surface)

| Field | Value |
|---|---|
| Requested tag | `dsh-v0.1.2-alpha.1` |
| Exact tag | `dsh-v0.1.2-alpha.1` |
| HEAD | `cd5ef8148158c3a752a658978873241fdf8e2bbc` (matches expected) |
| Latest `dsh-v*` tag | `dsh-v0.1.2-alpha.1` |
| Commits on `origin/master` since tag touching `packages/subagent`, `packages/experimental/agent-team`, `docs/user/develop` | **none** |
| Cordis at this tag | `@deepseek-ai/cordis@4.0.1` (`vendor/cordis`) |

## Cordis / schemastery

| Field | Value |
|---|---|
| Cordis | `@deepseek-ai/cordis@^4.0.1` |
| Schemastery (runtime Config) | `@deepseek-ai/schemastery@^3.18.1` (DSH vendor pin `3.18.1`) |

## Deviation log

- Spec text said `master` for kimi-code; remote default is `main`. Diffed against `origin/main`.
- No tower commits newer than 0.39.1 on main → implementation pins **0.39.1 tree as-is**.
- DSH peer target: compatible with `dsh@0.1.2-alpha.1` / `@deepseek-ai/cordis@^4.0.1`.
