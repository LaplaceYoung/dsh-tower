# dsh-tower — 把 Kimi Code Tower 接到 DeepSeek Harness

**dsh-tower** 是一个社区 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件：把 [Kimi Code Tower](https://github.com/MoonshotAI/kimi-code/tree/master/packages/agent-core-v2/src/features/tower) 协议挂到 DSH 原生插件缝上（`ctx.tools` / `ctx.commands` / `ctx.subagents` / `tools/pre-execute` / `systemPrompt`）。

主 Agent 当**塔台**。工人 Agent 在**隔离的 git worktree** 里施工。审查员必须给出**干净 review**。只有通过**协议硬门**后才合并回主分支。

[English](./README.md) · [中文](./README.zh.md)

> **实验功能，默认关闭。** 装上插件不等于 `Tower*` 进入默认 toolset。用 `DSH_EXPERIMENTAL_TOWER=1` 或 profile 里 `cordis.patch.yml` 的 `experimental: true` 打开。

## 它解决什么问题

多个 AI 编程 Agent 挤在同一个工作区会互相覆盖文件、把 `git status` 搞脏，也无法按任务独立审查。

Tower 补上普通子代理「总分」结构没有的三层：

| 层 | 保证 |
|---|---|
| **隔离** | 每个 mission 一个 git worktree + 互斥文件 scope |
| **通信** | inbox / findings / reviews 原子落盘；`.dsh-tower/comms/state.json` 是唯一可变真相 |
| **闸门** | 必须干净 review、review 后 tip 未动、依赖已合、三方 diff 落在 scope 内、非 detached HEAD |

它**不是** Swarm（总-分-总、共享工作区），也**不是** DSH 官方 `agent-team`。

## 适合谁

- 想在 DeepSeek Harness 里用 Kimi Code `/tower` 工作流的用户
- 想看如何用 DSH 原生缝挂载多智能体协议的插件作者
- 需要多个 Agent 在互斥路径上并行改同一仓库、并且合并前必须过审查门的团队

如果你要的是共享工作区 swarm、给人预览的 `dsh-worktree`，或官方 `agent-team` 邮箱，请不要用这个插件。

## 快速开始

运行时兼容目标是 DSH 源码 tag **`dsh-v0.1.2-alpha.1`**。

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git checkout dsh-v0.1.2-alpha.1
pnpm install && pnpm run build

pnpm dsh plugin --profile web add github:LaplaceYoung/dsh-tower
# 或本地路径：
# pnpm dsh plugin --profile web add /absolute/path/to/dsh-tower

export DSH_EXPERIMENTAL_TOWER=1
pnpm dsh web --no-open
```

会话里：

```text
/tower on
/tower <objective>
/tower status
/tower teardown
```

也可在 profile 的 `cordis.patch.yml` 里把 `dsh-tower.config.experimental` 设为 `true`（与环境变量二选一即可）。

## Tower 怎么跑

```text
用户目标
    |
    v
塔台（主 Agent）
    |  拆成互斥 scope 的 mission
    v
工人 -- 隔离 git worktree --> 审查员（只读）
    |
    v
TowerMerge 硬门 --> main
    |
    v
/tower teardown  （脏 worktree 会保留）
```

- 工人用 `ctx.subagents.startContinuable` 拉起（禁止 `start()`），mission 可续跑。
- 审查员不能 `write` / `edit` / `str_replace_editor`。
- 工人不能写主仓；`ctx.tools.guard` + `tools/pre-execute` 拒绝越界写出。
- 进度靠工具返回值和 `.dsh-tower/comms/log/activity.log`，不往 DSH session 词表追加自定义事件。

## 它是什么 / 不是什么

| 是 | 不是 |
|---|---|
| 每 mission 一个隔离 worktree + 审查门 + 合并门 | Swarm（总-分-总、共享工作区） |
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
| `ctx.tools.register` + `defineTool` | 11 个 `Tower*` 工具 |
| `ctx.tools.guard` | 同步写出守卫（工人不得写主仓） |
| `ctx.on('tools/pre-execute')` | 异步权威 veto（读 roster 后拒绝越界 Write/Edit） |
| `ctx.commands.register` | `/tower` 斜杠命令；`agent.steer` 注入操作手册 |
| `ctx.subagents.startContinuable` | 工人/审查员续跑（禁止 `start()`） |
| `ctx.on('subagent/end')` | 释放 inflight 并发槽 |
| `ctx.systemPrompt.section` | 实验开启时向模型宣告 Tower（可关 `announceToAgent`） |

不 vendor、不 fork `deepseek-harness`。

## 版本钉扎

详见 [`PINNED.md`](./PINNED.md)。最近一次核对：2026-08-28。

| 上游 | Pin |
|---|---|
| Kimi Code Tower | `@moonshot-ai/kimi-code@0.39.1` → `packages/agent-core-v2/src/features/tower/` |
| DeepSeek Harness | `dsh-v0.1.2-alpha.1`（`cd5ef814…`） |
| Cordis | `@deepseek-ai/cordis@^4.0.1` |

npm 上公开的 peer 最近一档是 `0.1.1-rc.2`；**运行时兼容目标仍是 `dsh@0.1.2-alpha.1`**。

## 开发

```bash
npm install
npm test          # 协议 + host 单测，不要求安装完整 DSH
npm run build
npm run smoke:dsh-pin
```

钉扎 tag 构建 DSH 后的本机验证：

```bash
pnpm dsh plugin --profile web add /path/to/dsh-tower
DSH_EXPERIMENTAL_TOWER=1 pnpm dsh web --port 3080 --no-open
# 浏览器打开日志里打印的带 token URL
```

## 目录

```
src/protocol/   # 零 Cordis，可单测的 TowerStore
src/host/       # apply、工具、/tower、spawn、guard、native seams
tests/protocol/
tests/host/
```

## 常见问题

### dsh-tower 是什么？

DeepSeek Harness 社区插件，移植 Kimi Code Tower：主 Agent 当塔台拆 mission，工人在隔离 git worktree 里写代码，审查员只读，合并必须过协议硬门。

### 怎么在 DeepSeek Harness 里启用 Kimi Tower？

把插件加到钉在 `dsh-v0.1.2-alpha.1` 的 DSH `web` profile，设置 `DSH_EXPERIMENTAL_TOWER=1`（或 `cordis.patch.yml` 里 `experimental: true`），再执行 `/tower on`。

### Tower 和 Swarm / DSH agent-team 有什么区别？

Swarm 是共享工作区的总-分-总。官方 `agent-team` 走邮箱。Tower 给每个 mission 独立 worktree 和 scope，审查 + 硬门通过后才合回主分支。

### 会不会 fork DeepSeek Harness 或 Kimi Code？

不会。协议在 `src/protocol/`，宿主只挂官方文档里的 DSH 缝。上游用 pin，不 vendor。

### 为什么默认关闭？

Tower 会注册 11 个工具、写出守卫和 `/tower` 操作手册。不显式打开时，普通 DSH 会话保持原样。

### 什么情况合不进去？

没有干净 review、review 之后 tip 动过、依赖 mission 未合并、改到了 scope 外的文件、或处于 detached HEAD。

## 源链接

- Tower 根目录：https://github.com/MoonshotAI/kimi-code/tree/master/packages/agent-core-v2/src/features/tower
- `TowerStore`：https://github.com/MoonshotAI/kimi-code/blob/master/packages/agent-core-v2/src/features/tower/protocol/store.ts
- 操作手册：https://github.com/MoonshotAI/kimi-code/blob/master/packages/agent-core-v2/src/features/tower/injection/tower-mode-full-reminder.md
- DSH 工具文档：https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/docs/user/develop/basic/tool.md
- 可继续子代理：https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/packages/subagent/subagent/src/continuation.ts

## 许可证

MIT。见 [LICENSE](./LICENSE)。
