# dsh-tower

DeepSeek Harness 社区插件：把 **Kimi Code Tower** 挂到 DSH 插件缝上（`ctx.tools` / `ctx.commands` / `ctx.subagents` / `tools/pre-execute` / `systemPrompt`）。

> Tower = 主 Agent 当塔台；工人在**隔离 git worktree**里施工；**审查通过 + 协议硬门**后才合并回主分支。

English: [README.md](./README.md)

## 版本钉扎

详见 [`PINNED.md`](./PINNED.md)。

| 上游 | Pin |
|---|---|
| Kimi Code Tower | `@moonshot-ai/kimi-code@0.39.1` → `packages/agent-core-v2/src/features/tower/` |
| DeepSeek Harness | `dsh-v0.1.2-alpha.1`（`cd5ef814…`） |
| Cordis | `@deepseek-ai/cordis@^4.0.1` |

npm 上公开的 peer 最近一档是 `0.1.1-rc.2`；**运行时兼容目标仍是 `dsh@0.1.2-alpha.1`**。

## 安装

### 从源码跑 DSH（推荐验证路径）

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git checkout dsh-v0.1.2-alpha.1
pnpm install && pnpm run build

# 把本插件链进 web profile
pnpm dsh plugin --profile web add github:LaplaceYoung/dsh-tower
# 或本地路径：
# pnpm dsh plugin --profile web add /absolute/path/to/dsh-tower

export DSH_EXPERIMENTAL_TOWER=1
pnpm dsh web --no-open
```

也可在 profile 的 `cordis.patch.yml` 里把 `dsh-tower.config.experimental` 设为 `true`（与环境变量二选一即可）。

**默认关闭。** 装上插件不等于 `Tower*` 进入默认 toolset。

### 用户入口

```text
/tower on
/tower off
/tower <objective>
/tower status
/tower teardown
```

## Cordis 原生化宿主

| 组件 | 作用 |
|---|---|
| `ctx.tower`（`TowerService`） | 模式 `enter` / `exit` / `isActive`、限流、roster 缓存 |
| `@deepseek-ai/schemastery` Config | `experimental`、`inflightCap`、`announceToAgent` |
| 模式注入 | full（`/tower on`）、sparse（spawn 后）、exit（`/tower off` / teardown） |
| Worker deny | 编排工具 + `AskUserQuestion` + `TodoList` |
| Reviewer deny | 上述 + write/edit |
| 模式中的 TodoList | 主 agent 经 `tools/pre-execute` 拒绝 |

差距分析见 [`PLAN.md`](./PLAN.md)。

## 它是什么 / 不是什么

| 是 | 不是 |
|---|---|
| 每 mission 一个隔离 worktree + 审查门 + 合并门 | Swarm（总–分–总、共享工作区） |
| `.dsh-tower/comms/state.json` 为唯一可变真相 | 官方 `agent-team` 邮箱 |
| 工人用 `startContinuable` 续跑 | `dsh-worktree` 给人预览再交付 |

## 协议不变量

1. `.dsh-tower/comms/state.json` 是唯一可变真相。
2. `MISSIONS.md` / `missions/*.md` 只生成，禁止手改。
3. 每个 mission 一个 worktree + 互斥 scope。
4. inbox / findings / reviews 用 frontmatter + 原子创建。
5. `TowerMerge` 硬门：clean review、review 后 tip 未动、deps 已合、三方 diff 落在 scope 内、非 detached HEAD。
6. 新会话 adopt：退役旧 roster，保留 mission 与 worktree。
7. 脏工作区：**拒绝** Init / 拒绝以脏 base 开 worktree（不学 Kimi #3346 静默用 HEAD）。
8. Reviewer 只读（`write` / `edit` / `str_replace_editor` 在 `toolFilter` 里拒绝）。

## 用到的 DSH 原生能力

| 缝 | 用途 |
|---|---|
| `ctx.tower` Service | 模式闩锁、限流、roster 缓存（`declare module` 类型） |
| `ctx.tools.register` + `defineTool` | 11 个 `Tower*` 工具 |
| `ctx.tools.guard` | 同步写出守卫（工人不得写主仓） |
| `ctx.on('tools/pre-execute')` | 异步越界 veto + 模式中拒绝 TodoList |
| `ctx.commands.register` | `/tower on\|off\|status\|teardown\|<objective>` |
| `ctx.subagents.startContinuable` | 工人/审查员续跑（禁止 `start()`） |
| `ctx.on('subagent/end')` | 释放 inflight 并发槽 |
| `ctx.systemPrompt.section` | 实验开启时向模型宣告 Tower（可关 `announceToAgent`） |
| `ctx.effect` | fiber 卸载时清理 mode / roster / 限流 |

**不会**往 DSH session 词表追加自定义事件（进度靠工具返回值与 `.dsh-tower/comms/log/activity.log`）。

## 开发

```bash
npm install
npm test          # 协议 + host 单测，不要求安装完整 DSH
npm run build
npm run smoke:dsh-pin
```

本机完整验证（本仓库 CI/agent 已跑通）：

```bash
# 钉扎 tag 构建 DSH 后
pnpm dsh plugin --profile web add /path/to/dsh-tower
DSH_EXPERIMENTAL_TOWER=1 pnpm dsh web --port 3080 --no-open
# 浏览器打开日志里打印的带 token URL
```

## 源链接

- Tower 根目录：https://github.com/MoonshotAI/kimi-code/tree/master/packages/agent-core-v2/src/features/tower
- `TowerStore`：https://github.com/MoonshotAI/kimi-code/blob/master/packages/agent-core-v2/src/features/tower/protocol/store.ts
- 操作手册：https://github.com/MoonshotAI/kimi-code/blob/master/packages/agent-core-v2/src/features/tower/injection/tower-mode-full-reminder.md
- DSH 工具文档：https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/docs/user/develop/basic/tool.md
- 可继续子代理：https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/packages/subagent/subagent/src/continuation.ts

## 目录

```
src/protocol/          # 零 Cordis，可单测的 TowerStore
src/host/              # apply、TowerService、工具、/tower、spawn、guard
src/host/injection/    # full / sparse / exit 提醒（.dsh-tower）
tests/protocol/
tests/host/
PLAN.md                # Cordis 原生化差距计划
```

不 vendor、不 fork `deepseek-harness`。
