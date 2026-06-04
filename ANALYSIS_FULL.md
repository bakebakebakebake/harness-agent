# Light-Agent v0.5.1 — 全景分析报告

> 版本：v0.5.1 · 包名：`light-agent-cli` · 二进制：`light-agent`
> 生成日期：2026-06-02
> 代码：17,412 行 TypeScript · 461 测试 · 50 测试文件 · 4 个 runtime 依赖

---

## 目录

1. [项目定位演变](#1-项目定位演变)
2. [架构总览](#2-架构总览)
3. [模块深度分析](#3-模块深度分析)
4. [代码质量分析](#4-代码质量分析)
5. [测试覆盖分析](#5-测试覆盖分析)
6. [竞品对标](#6-竞品对标)
7. [问题诊断](#7-问题诊断)
8. [路线图](#8-路线图)

---

## 1. 项目定位演变

### 1.1 演化轨迹

```
v0.1–0.2:  "Claude Code 式的编码 Agent 最小实现"
              → 证明 ReAct loop + Tool 模式可行

v0.3:      "本地优先的命令行编码 Agent"
              → 记忆系统 + 权限层 + 会话管理 — 可日常使用

v0.4:      "安全可控的生产级编码 Agent"
              → 命令拆分 + blockedCommands + protectedPaths + Tavily

v0.5:      "面向开发者的通用自动化平台"
              → 多模态 + 调度器 + GUI 自动化 — 超出编码范畴
```

### 1.2 当前定位陈述

> Light-Agent 是一个**本地优先、Provider 中立的通用自动化 Agent CLI**。它从编码辅助出发，逐步扩展为能处理定时任务、桌面 GUI 操作、跨会话记忆的个人自动化基础设施。核心差异化：极简依赖（4 个 runtime package）、完整的本地优先架构、中英双语支持。

### 1.3 关键数据

| 指标 | 值 | 趋势 |
|------|-----|------|
| 源文件数 | 87 个 `.ts` 文件 | ↑（v0.3.2: ~40） |
| 代码行 | 17,412 行 | ↑（v0.3.2: ~8,500） |
| 测试数 | 461 个 `it()` | ↑（v0.3.2: 366） |
| 测试文件 | 50 个 | ↑（v0.3.2: 41） |
| Runtime 依赖 | 4 个 | → 未变 |
| devDependencies | 4 个 | → 未变 |
| 编译器 | tsc (bundler moduleResolution) | → 未变 |
| Node 版本 | >=20 | → 未变 |

**核心发现**：代码行数翻了一倍，但 runtime dep 没有增加——这是很好的信号，说明新功能都是用现有基础设施实现的，没有引入外部重量级库。

---

## 2. 架构总览

### 2.1 目录结构

```
src/
├── cli.ts                    # 840 行 — REPL 主入口
├── config.ts                 # 369 行 — 配置解析/env 加载
├── pendingContext.ts          # 154 行 — 统一的附件管理 (skill/MCP/image)
├── prompt.ts                 # 85 行  — System prompt 组装
│
├── commands/                 # 2,939 行 — 斜杠命令
│   ├── builtins.ts           # 778 行 — exit/clear/compact/resume/todo/usage/mode/rewind/thinking/keys/mcp/protect/reload/help
│   ├── registry.ts           # 332 行 — 命令注册/排序/completion/menu
│   ├── interactionCommands.ts # 578 行 — diff/search/skill/debug
│   ├── memoryCommands.ts     # 381 行 — memory/remember/forget
│   ├── profileCommands.ts    # 567 行 — profile/model/config
│   ├── scheduleCommands.ts   # 259 行 — schedule (add/list/show/remove/pause/resume/run-now/status/stop-runner)
│   └── guiCommands.ts        # 44 行  — gui (list/apps/doctor)
│
├── loop/                     # 502 行 — Agent 核心循环
│   ├── agentLoop.ts          # 295 行 — ReAct async generator
│   ├── compact.ts            # 153 行 — 上下文压缩
│   └── types.ts              # 54 行  — LoopEvent/LoopStopReason
│
├── model/                    # 1,635 行 — 模型交互层
│   ├── types.ts              # 129 行 — ModelProvider/ModelEvent/ContentBlock
│   ├── anthropic.ts          # 263 行 — Anthropic Messages API 适配器
│   ├── openai.ts             # 677 行 — OpenAI-compatible 适配器
│   ├── index.ts              # 34 行  — 按 config.provider 选择适配器
│   ├── models.ts             # 171 行 — 模型发现/目录获取
│   ├── selection.ts          # 170 行 — 交互式模型选择
│   ├── contextWindow.ts      # 66 行  — 模型→窗口大小表
│   ├── contextEstimate.ts    # 41 行  — 本地 token 预估
│   └── smoke.ts              # 84 行  — 模型连通性冒烟测试
│
├── tools/                    # 2,558 行 — 工具层 (20 个工具)
│   ├── types.ts              # 112 行 — Tool/ToolContext/ToolResult 接口
│   ├── registry.ts           # 86 行  — ToolRegistry
│   ├── read.ts               # 167 行 — 读文件 (low/concurrent)
│   ├── write.ts              # 125 行 — 写文件 (medium/exclusive)
│   ├── edit.ts               # 194 行 — 精确替换 (medium/exclusive)
│   ├── bash.ts               # 130 行 — 参数化命令执行 (high/exclusive)
│   ├── shell.ts              # 84 行  — shell 管道命令 (high/exclusive)
│   ├── grep.ts               # 181 行 — 正则搜索 (low/concurrent)
│   ├── ls.ts                 # 120 行 — 目录列举 (low/concurrent)
│   ├── glob.ts               # 141 行 — 文件模式匹配 (low/concurrent)
│   ├── web.ts                # 134 行 — 网页搜索/抓取 (low/concurrent)
│   ├── subagent.ts           # 105 行 — 子 agent 隔离 (medium/exclusive)
│   ├── mcp.ts                # 113 行 — MCP 工具搜索 (low/exclusive)
│   ├── memory.ts             # 355 行 — 5 个记忆工具 (low/med)
│   ├── todo.ts               # 95 行  — 待办列表读写
│   ├── skill.ts              # 94 行  — 技能加载 (low/concurrent)
│   └── macosGui.ts           # 72 行  — macOS GUI (high/exclusive)
│
├── permissions/              # 313 行 — 权限系统
│   ├── policy.ts             # 100 行 — PermissionMode + denial tracking
│   ├── confirm.ts            # 128 行 — PermissionGate + Confirmer 接口
│   └── protect.ts            # 85 行  — blockedCommands + protectedPaths
│
├── memory/                   # 1,332 行 — 原生记忆系统
│   ├── types.ts              # 103 行 — MemoryCard/MemoryContextPacket
│   ├── paths.ts              # 39 行  — 存储路径解析
│   ├── store.ts              # 518 行 — Markdown 卡片 + SQLite 索引
│   ├── retrieve.ts           # 305 行 — 检索 + rerank + 预算注入
│   ├── extract.ts            # 178 行 — 自动提炼
│   ├── digest.ts             # 73 行  — Core Digest
│   ├── transcript.ts         # 67 行  — 会话证据 JSONL
│   ├── sqlite.ts             # 41 行  — SQLite 包装
│   └── index.ts              # 8 行   — 重导出
│
├── scheduler/                # 455 行 — 调度器子系统
│   ├── types.ts              # 34 行  — ScheduledJob/SchedulerStore
│   ├── store.ts              # 192 行 — JSON 持久化/cron 计算
│   └── runner.ts             # 229 行 — 守护进程/任务执行
│
├── mcp/                      # 311 行 — MCP 运行时
│   ├── types.ts              # 41 行  — McpToolCandidate/McpRuntime/McpServerStatus
│   └── runtime.ts            # 270 行 — LocalMcpRuntime (stdlib client)
│
├── gui/                      # 267 行 — macOS GUI 自动机
│   └── macos.ts              # 267 行 — AppleScript/JXA 桥 (15 actions)
│
├── ext/                      # 530 行 — 可扩展性
│   ├── skills.ts             # 173 行 — Skills 加载/搜索/格式化
│   ├── commands.ts           # 81 行  — 自定义命令加载
│   ├── mcp.ts                # 70 行  — MCP 配置发现
│   ├── paths.ts              # 56 行  — 扩展目录解析
│   ├── fileSearch.ts         # 64 行  — @ 文件搜索
│   └── repoConfig.ts         # 86 行  — .agents/harness-agent.json
│
├── ui/                       # 3,951 行 — 终端 UI (最大模块)
│   ├── lineEditor.ts         # 1,019 行 — 行编辑器 (raw mode)
│   ├── markdown.ts           # 455 行  — Markdown 流式渲染
│   ├── input.ts              # 285 行  — LineReader (ask/pick/secret)
│   ├── keys.ts               # 253 行  — stdin 键事件
│   ├── editorRender.ts       # 246 行  — 编辑器渲染视图
│   ├── render.ts             # 244 行  — LoopEvent 渲染器
│   ├── menu.ts               # 206 行  — 菜单渲染/模糊匹配
│   ├── transcript.ts         # 112 行  — 对话回放
│   ├── theme.ts              # 111 行  — ANSI 颜色/CJK 宽度
│   ├── diff.ts               # 153 行  — diff 渲染
│   ├── status.ts             # 147 行  — 状态行/footer
│   ├── frame.ts              # 58 行   — 输入框边框
│   ├── mascot.ts             # 65 行   — 吉祥物
│   ├── spinner.ts            # 53 行   — 等待指示器
│   ├── interrupt.ts          # 64 行   — Ctrl-C 中断
│   ├── format.ts             # 30 行   — 文本工具
│   └── toolLine.ts           # 31 行   — 工具调用行渲染
│
├── util/                     # 1,207 行 — 工具函数
│   ├── web.ts                # 341 行 — 网页搜索/抓取 (Tavily+Bing)
│   ├── images.ts             # 322 行 — 图片处理 (验证/剪贴板/路径)
│   ├── shell.ts              # 243 行 — 进程执行引擎
│   ├── git.ts                # 165 行 — git 操作 (diff/branch)
│   ├── logger.ts             # 56 行  — 结构化日志
│   ├── fileTree.ts           # 67 行  — 文件树构造
│   └── errors.ts             # 13 行  — 错误分类
│
├── subagents.ts              # 20 行  — SubagentRequest/SubagentResult 类型
├── profiles.ts               # 215 行 — 全局 profile 存储
├── sessions.ts               # 171 行 — 会话持久化
├── onboarding.ts             # 174 行 — 首次运行向导
├── todos.ts                  # 53 行  — 待办列表
└── subagents.ts              # 20 行  — 子 agent 类型
```

### 2.2 核心数据流

```
用户输入
  │
  ├── "#skill"          → pendingContext.ts → 附件队列 (skill/MCP/image)
  │
  ├── "/"               → commands/registry.ts → dispatch → 命令执行
  │
  ├── "!"               → util/shell.ts → runShell (login shell, bypass model)
  │
  └── 其他文本/图片     → runAgentLoop()
        │
        ├── memory/retrieve.ts    → 记忆注入 (core digest + cards)
        ├── ext/skills.ts         → 技能注入
        ├── pendingContext.ts     → 附件注入 (技能正文 + 图片)
        │
        ↓
      ModelProvider.stream()
        │
        ├── model/anthropic.ts    → Anthropic Messages API
        └── model/openai.ts       → OpenAI-compatible API
        │
        ↓
      解析 tool_use
        │
        ↓
      permissions/confirm.ts      → PermissionGate
        ├── permissions/protect.ts  → blockedCommands + protectedPaths 检查
        ├── permissions/policy.ts   → mode + denial tracking
        └── ─→ Confirmer (real stdin)
        │
        ↓
      tool.execute()             → 20 个工具之一
        │
        ↓
      结果喂回模型 → 继续循环
        │
        ↓
      end_turn / max_turns (50) / abort / error
        │
        ↓
      ✅ auto-save session
      ✅ append transcript evidence
      ✅ memory extraction (every N turns)
      ✅ auto-compact (>85% context window)
```

### 2.3 关键架构指标

| 指标 | 值 | 评估 |
|------|-----|------|
| 最大文件 | `lineEditor.ts` 1,019 行 | ⚠️ 偏大 |
| 第二大文件 | `cli.ts` 840 行 | ⚠️ 偏大 |
| 工具数 | 20 个 | ✅ 覆盖完整 |
| 命令数 | 24 个 | ✅ 覆盖完整 |
| Runtime 依赖 | 4 个 | ✅ 极简 |
| Interface/抽象层 | ModelProvider, Tool, PermissionGate, McpRuntime, Confirmer | ✅ 清晰 |
| 唯一 confinement 边界 | `resolveInWorkdir()` | ✅ 审计点集中 |
| Provider 数量 | 2 (Anthropic, OpenAI) | ✅ 中性 |
| 测试工具 | vitest | ✅ 标准 |

---

## 3. 模块深度分析

### 3.1 CLI 层 (`cli.ts`, 840 行)

**职责**：REPL 主循环，串接所有模块。

**设计亮点**：
- `seedNext` 机制：Ctrl-C 中断后回填输入，让用户可以编辑重发
- `classifyRuntimeError()`（现位于 `util/errors.ts`）：将错误分为配置/网络/工具/内部四类
- 附件系统的 `badges()` 回调：同时显示 skills / MCP / images 三类状态

**问题**：
- 840 行，职责仍然过多。可以拆分的职责：子 agent runner（~80 行）、post-turn 处理（~30 行）、banner 打印（~40 行）
- `maybeAutoCompact()` 和 `runShellCommand()` 仍在 cli.ts 中定义，虽然逻辑上属于这里但增加了文件长度

### 3.2 Agent 核心循环 (`loop/agentLoop.ts`, 295 行)

**职责**：ReAct while 循环。

**设计亮点**：
- AsyncGenerator + LoopEvent 模式——可测试、可增量渲染
- `PermissionGate` 完全在循环外部
- `ToolContext` 统一环境传递（signal, workdir, allowOutside, mcp, runSubagent, todoStore）

**关键约束**：
- `maxTurns` 硬上限（默认 50）
- AbortSignal 在多个点检查
- `parseToolInput()` 容错处理不完整 JSON

**与竞品对比**：
- Claude Code 同一层约 8,000 行（含编排逻辑）
- Light-Agent 的 loop 层（含 compact）仅 502 行——绝对简洁
- **缺少**：响应式压缩、语义去重、模型回退

### 3.3 工具层 (`tools/`, 2,558 行, 20 个工具)

**工具矩阵**：

| 工具 | 行数 | 风险 | 并发 | 独特设计 |
|------|------|------|------|----------|
| `memory.ts` | 355 | low/med | mixed | 5 个工具合一文件 |
| `grep.ts` | 181 | low | concurrent | 正则搜索 + confinement |
| `read.ts` | 167 | low | concurrent | 行号/分页/截断 |
| `glob.ts` | 141 | low | concurrent | 模式匹配 |
| `web.ts` | 134 | low | concurrent | 搜索+抓取合一 |
| `bash.ts` | 130 | high | exclusive | argv 参数化防注入 |
| `write.ts` | 125 | medium | exclusive | 路径 confinement |
| `ls.ts` | 120 | low | concurrent | |
| `mcp.ts` | 113 | low | exclusive | 动态注册 |
| `subagent.ts` | 105 | medium | exclusive | 任务隔离 |
| `todo.ts` | 95 | low | mixed | 读写分离 |
| `skill.ts` | 94 | low | concurrent | 动态加载 |
| `shell.ts` | 84 | high | exclusive | shell 语法支持 |
| `macosGui.ts` | 72 | high | exclusive | AppleScript 桥 |
| `edit.ts` | 194 | medium | exclusive | 精确替换+diff |
| `registry.ts` | 86 | — | — | 注册表 |

**问题**：
- `memory.ts`（355 行）存放了 5 个工具（search/write/update/forget/drill），建议拆分
- `bash` 和 `shell` 在功能上有重叠，但风险等级和使用场景不同（bash=argv/shell=pipe）
- `macos_gui` 是平台锁定工具，运行时检查 `process.platform`

### 3.4 权限系统 (`permissions/`, 313 行)

**三层架构**：

```
1. Policy:   4 种 mode + denial tracking (100 行)
2. Confirm:  PermissionGate + Confirmer 接口 (128 行)
3. Protect:  blockedCommands + protectedPaths (85 行)
```

**权限检查流程**：
```
gate({tool, input})
  → protect.ts:  检查 blockedCommands + protectedPaths
  → policy.ts:   按 mode + riskLevel 决定 action (allow/notify/confirm/deny)
  → confirm.ts:  如果是 confirm，通过 Confirmer 问用户
  → 返回 {allow: true/false, reason}
```

**问题**：
- 没有作用域允许（同一会话中类似操作再次确认）
- 没有跨会话 denial tracking 持久化
- protect.ts 只检查了 shell/bash/edit/write 四个工具
- 缺少对 `git push` / `rm -rf` 等常见危险命令的默认 deny 规则

### 3.5 记忆系统 (`memory/`, 1,332 行)

**四层架构**：
```
Transcript Evidence (JSONL) → Memory Cards (Markdown) → SQLite Index (FTS5) → Core Digest
```

**写入路径**：
- 显式：`/remember` / `memory_write`
- 自动：每 N 个用户 turn 后 `extractAndApplyMemory()`

**检索流程**：
1. `classifyMemoryIntent()` — 判断意图类型（procedural/preference/factual/historical/constraint_aware）
2. FTS5 搜索 + fallback 关键词匹配
3. `rerank()` — 综合 scope/tier/freshness/quality/importance/trust
4. budget-aware 注入（默认 3,000 token）

**亮点**：
- `supersedes` 机制处理记忆冲突演化
- `isDurableCandidate()` 同时覆盖中英文
- 检索刷新 `accessCount` + `lastAccessedAt` 但不改 `updatedAt`

**问题**：
- ❌ **无 embedding 语义搜索**——FTS5 无法处理同义词和概念相似性
- ❌ 无记忆质量自动评估
- ❌ 无跨项目记忆共享
- ❌ 无记忆衰减机制

### 3.6 调度器 (`scheduler/`, 455 行)

**全新子系统**，是 v0.5.x 最大的架构亮点。

**架构**：
```
/schedule add → JSON 持久化 → startSchedulerDaemon()
                                  → fork 子进程 (detached)
                                       → 30s 轮询 runDueJobs()
                                            → runScheduledJob(job)
                                                 → 独立 runAgentLoop()
                                                 → denyingConfirmer 模式
                                                 → 结果写入 JSONL
```

**设计决策评估**：

| 决策 | 评价 |
|------|------|
| 子进程隔离 (detached+unref) | ✅ 正确——REPL 退出后调度器继续运行 |
| PID 文件检测 | ✅ 标准做法 |
| JSONL 运行记录 | ✅ 可审计 |
| denyingConfirmer | ⚠️ 安全但限制太多——所有高风险工具被拒绝 |
| 30s 轮询 | ✅ 合理默认值 |
| 无日志轮换 | ⚠️ 是已知问题 |
| nextRunAt 计算逻辑 | ✅ 正确处理跨天/跨周边界 |

**关键问题**：
- `denyingConfirmer` + `PermissionPolicy` 默认模式 = 调度任务无法做任何文件修改或执行命令
- **调度任务实际上只能读文件和搜索 Web**——这严重限制了可用性
- 需要 `schedulerPolicy` 概念，允许调度任务使用受控工具集

### 3.7 多模态 (`util/images.ts` + `model/anthropic.ts`)

**全新子系统**，实现了从输入到 API 的完整图片 pipeline。

**4 种入口**：
1. 直接路径：`consumeImagePathsFromText()` 从输入中自动提取
2. 剪贴板：`importClipboardImage()` JXA `NSPasteboard` 读取
3. 拖拽：`detectDroppedImagePaths()` shell token 解析
4. `/image add`：手动指定

**技术实现**：
- `validateImagePath()`：MIME 检测 + 大小限制（20MB/文件，40MB/总计）
- 剪贴板 TIFF → sips 转 PNG
- `enforceVisionMode()`：auto/on/off 三模式
- `modelSupportsVision()`：按 provider+model 判断能力

**问题**：
- ❌ 剪贴板仅 macOS（JXA 依赖）
- ⚠️ OpenAI 适配器的 image support 未确认
- ⚠️ 图片不会出现在 transcript 回放中

### 3.8 macOS GUI (`gui/macos.ts`, 267 行)

**全新子系统**，结构化 AppleScript 生成器。

**评估**：
- 结构化模板（15 个 action）比自由文本 AppleScript 安全得多
- `describeAction()` 在确认前显示完整脚本源码是很好的安全实践
- `doctorMacosGui()` 诊断支持
- 仅 macOS + 需要 Accessibility 权限

### 3.9 命令系统 (`commands/`, 2,939 行, 24 个命令)

**命令分类**：

| 类别 | 命令 | 行数 |
|------|------|------|
| 基本 | exit, clear, help, keys | ~50 |
| 配置 | config, profile, model, mode, thinking | ~1,000 |
| 会话 | resume, rewind, rename, compact, todo, usage | ~600 |
| 记忆 | memory, remember, forget | ~600 |
| 工具 | diff, search, skill, mcp, protect | ~600 |
| **新** | **schedule, gui** | **~300** |

**命令注册流程**：
1. `buildRegistry()` 注册 24 个 builtin 命令
2. `/reload` 从 `.agents/commands/` 加载自定义命令
3. Tab 补全：`/pro<Tab>` → `/profile`，`/profile <Tab>` → `use|new|edit|rm`
4. `/` 菜单：exact > prefix > keyword > description 排序

### 3.10 UI 层 (`ui/`, 3,951 行 — 最大模块)

**组成**：
- `lineEditor.ts`（1,019 行）：raw-mode 行编辑器
- `markdown.ts`（455 行）：流式 Markdown 渲染
- 其余 16 个文件：辅助渲染

**亮点**：
- 零依赖 ANSI（`theme.ts`）
- `visibleWidth()` 正确处理 CJK 宽字符
- `#` skill picker、`@` 文件 picker、`/` 命令 picker
- Attachments 区域导航（↑/Backspace）
- `editorRender.ts` 的增量渲染支持（`shouldFullRedraw()` / `changedRowIndices()`）

**问题**：
- `lineEditor.ts` 1,019 行——工具层最长的文件
- Markdown 渲染不支持表格
- Resize 闪烁问题未完全解决

---

## 4. 代码质量分析

### 4.1 文件大小分布

```
1,000–1,100 行:  lineEditor.ts (1,019)
  800–900 行:   cli.ts (840), builtins.ts (778)
  500–700 行:   openai.ts (677), interactionCommands.ts (578), profileCommands.ts (567),
                memory/store.ts (518), markdown.ts (455)
  300–500 行:   memory/retrieve.ts (305), input.ts (285), agentLoop.ts (295),
                gui/macos.ts (267), keys.ts (253), editorRender.ts (246),
                render.ts (244), shell.ts (243), profiles.ts (215), menu.ts (206)
  100–300 行:   29 个文件
  <100 行:      30 个文件
```

**评估**：文件大小分布基本健康。`lineEditor.ts`（1,019 行）和 `cli.ts`（840 行）是主要的重构目标。

### 4.2 测试分布

```
测试最多的文件:
  commands.test.ts      (57 tests / 1,078 行)  — 命令系统
  tools.test.ts         (26 tests / 394 行)    — 工具注册
  lineEditor.test.ts    (26 tests / 577 行)    — 行编辑器
  profiles.test.ts      (22 tests / 240 行)    — profile 管理
  thinking.test.ts      (12 tests / 158 行)    — thinking 深度
  shell.test.ts         (12 tests / 116 行)    — shell 执行
  edit.test.ts          (12 tests / 55 行)     — 编辑工具
  sessions.test.ts      (11 tests / 127 行)    — 会话管理
  diff.test.ts          (11 tests / 107 行)    — diff 命令

缺少测试的核心文件:
  gui/macos.ts           (0 tests)              — ⚠️ GUI 自动化
  scheduler/runner.ts    (0 tests)              — ⚠️ 调度器守护进程
  pendingContext.ts      (0 tests)              — ⚠️ 附件管理
  cli.ts                 (0 direct tests)       — ⚠️ 主 REPL
  tools/macosGui.ts      (0 tests)              — ⚠️ GUI 工具

测试覆盖不足的:
  memory/         — 6 文件, 20 测试 (对于 1,332 行的子系统偏低)
  model/          — 2 文件, 23 测试 (对于 1,635 行的子系统偏低)
```

### 4.3 依赖分析

**Runtime 依赖（4 个）**：
```
@anthropic-ai/sdk       0.32.1     — Anthropic Messages API
@modelcontextprotocol/sdk ^1.29.0  — MCP 客户端
diff                    7.0.0      — 文件 diff
zod                     3.24.1     — 运行时验证
```

**Dev 依赖（4 个）**：
```
@types/diff, @types/node, tsx, typescript, vitest
```

**评估**：4 个 runtime dep 是 Light-Agent 的核心优势。任何功能都不应增加这个数字——新的搜索后端（Tavily）通过 `fetch` 实现，不引入 SDK；图片处理用 `spawnSync("osascript")` 而非 npm 包；调度器完全用 Node.js 内置 API。

### 4.4 类型安全

- `"strict": true` + `"noUncheckedIndexedAccess": true` + `"noImplicitOverride": true`
- 所有工具输入使用 `zod` schema 验证
- `ModelProvider` / `Tool` / `PermissionGate` 等核心接口都是 `interface` 而非 `type`
- 一处显式类型绕过：Anthropic 适配器中 `delta as { type: string; thinking?: string }`

---

## 5. 测试覆盖分析

### 5.1 总体统计

| 指标 | 值 |
|------|-----|
| 总 `it()` 数 | 461 |
| 测试文件数 | 50 |
| 平均每文件 | 9.2 tests |
| 最大测试文件 | `commands.test.ts` (57 tests / 1,078 行) |
| 最小测试文件 | `mascot.test.ts` (5 tests / 27 行) |
| 零测试文件 | `gui/macos.ts`, `scheduler/runner.ts`, `pendingContext.ts`, `cli.ts` |

### 5.2 高风险低覆盖区域

| 区域 | 行数 | 测试数 | 风险 |
|------|------|--------|------|
| GUI 子系统 | 267 | 2 (macosGui.test.ts) | 🔴 高风险 |
| 调度器子系统 | 455 | 4 (scheduler.test.ts) | 🟡 中风险 |
| 附件管理系统 | 154 | 0 | 🟡 中风险 |
| 行编辑器 | 1,019 | 26 | 🟢 低风险 |
| 图片处理 | 322 | 4 | 🟡 中风险 |

### 5.3 测试质量评估

```
优秀的测试:   lineEditor.test.ts (fake KeySource 驱动 UI) ✅
              commands.test.ts (直接测试命令运行) ✅
              tools.test.ts (工具注册和 basic 正确性) ✅

缺失的测试:   macosGui command (guiCommands.ts) ⚠️
              schedule command (scheduleCommands.ts) ⚠️
              pendingContext.ts 附件管理 ⚠️
              env 加载链 (config.ts 的 loadDotEnv) ⚠️
```

---

## 6. 竞品对标

### 6.1 四维对比矩阵

| 能力 | Light-Agent v0.5.1 | Claude Code | Codex CLI | OpenCode |
|------|--------------------|-------------|-----------|----------|
| **核心** | | | | |
| 代码行数 | 17,412 TS | ~510,000 TS | Rust | TS |
| Runtime | Node 20+ | Bun | Native | Node |
| Deps | 4 runtime | 专有 | — | — |
| Provider | Anthropic+OpenAI | Anthropic only | OpenAI only | 多 provider |
| **编码** | | | | |
| 精确编辑 | ✅ 字符串替换+diff | ✅ | ✅ | ✅ |
| 上下文压缩 | 1层 compact | 5层管线 | compact API | 类似 |
| 对话存档 | JSON 存档 | JSONL transcript | — | — |
| 子 Agent | 线程级 | Git worktree | 多 agent | Scout agent |
| **安全** | | | | |
| 权限模式 | 4种 + denial tracking | 7层 + ML | 可配置策略 | 基本 |
| 路径保护 | ✅ blockedCommands | ✅ | ✅ | — |
| Shell 注入防护 | ✅ argv 参数化 | ✅ | ✅ | ✅ |
| **独特** | | | | |
| 调度器 | ✅ 守护进程模式 | ✅ Scheduled Tasks | ❌ | ❌ |
| 多模态 | ✅ 图片输入 | ✅ | ✅ | ❌ |
| GUI 自动化 | ✅ macOS AppleScript | 浏览器 | Chrome ext | ❌ |
| 记忆系统 | ✅ 3层+digest | ✅ Auto memory | ✅ Pipeline | ❌ |
| Web 搜索 | ✅ Tavily+Bing | ✅ 内建 | 浏览器 | 内建 |
| **生态** | | | | |
| MCP | stdio | stdio+HTTP+OAuth | stdio+HTTP+OAuth | stdio |
| Skills | ✅ | ✅ | ✅ | ✅ |
| Hooks | ❌ | ✅ | ✅ | — |
| Plugin 市场 | ❌ | ✅ Beta | ✅ | — |
| **UX** | | | | |
| Vim 模式 | ❌ | ✅ | ✅ | — |
| 远程控制 | ❌ | ✅ Browser+Mobile | ✅ CLI remote | — |
| 多行编辑 | ✅ | ✅ | ✅ | — |

### 6.2 Light-Agent 的独特优势

1. **调度器（守护进程模式）** — Claude Code 有 Scheduled Tasks，但 Light-Agent 的子进程+JSONL 运行记录架构更简洁透明
2. **macOS GUI 自动化** — 其他 agent 没有桌面应用操控能力（Claude Code 的 Browser Use 是 Web 端）
3. **极简依赖** — 4 个 runtime dep，其他竞品无法比拟
4. **Provider 中立** — Claude Code 只支持 Anthropic，Codex 只支持 OpenAI
5. **中英双语** — 记忆提炼、文档、系统提示都原生支持中文

---

## 7. 问题诊断

### 7.1 功能性问题

| # | 问题 | 严重性 | 模块 |
|---|------|--------|------|
| F1 | 调度任务因 `denyingConfirmer` 无法执行任何修改操作 | 🔴 | scheduler/runner.ts |
| F2 | lineEditor resize 闪烁 | 🟡 | ui/lineEditor.ts |
| F3 | OpenAI 适配器的图片支持未实现 | 🟡 | model/openai.ts |
| F4 | 调度器守护进程日志无限增长 | 🟡 | scheduler/runner.ts |
| F5 | 没有作用域允许（会话内同类操作重复确认） | 🟡 | permissions/ |
| F6 | 剪贴板图片导入仅 macOS | 🟡 | util/images.ts |
| F7 | 无法 fork 会话 | 🟡 | sessions.ts |

### 7.2 架构性问题

| # | 问题 | 严重性 | 说明 |
|---|------|--------|------|
| A1 | 上下文仅单层压缩 | 🔴 | 长会话质量下降 |
| A2 | 无 embedding 记忆检索 | 🟡 | 语义理解受限 |
| A3 | 无 hooks 系统 | 🟡 | 扩展性受限 |
| A4 | 无子 agent worktree 隔离 | 🟡 | 安全/冲突风险 |
| A5 | MCP 仅支持 stdio | 🟡 | 远程扩展受限 |
| A6 | macOS 锁定 | 🟡 | GUI + 剪贴板 |

### 7.3 质量问题

| # | 问题 | 严重性 | 说明 |
|---|------|--------|------|
| Q1 | GUI + 调度器 + 附件管理零测试 | 🔴 | 新增代码无回归保护 |
| Q2 | `lineEditor.ts` 1,019 行 | 🟡 | 重构目标 |
| Q3 | `cli.ts` 840 行 | 🟡 | 重构目标 |
| Q4 | `memory.ts` 含 5 个工具 | 🟡 | 应拆分 |
| Q5 | 记忆/模型子系统测试覆盖率偏低 | 🟡 | 1,332+1,635 行共 43 测试 |

---

## 8. 路线图

### 8.1 三支柱路线图

#### 支柱 1：根基加固（当前最重要的）

| # | 任务 | 工时 | 说明 |
|---|------|------|------|
| 1.1 | 调度器权限策略 | 2-3天 | 允许调度任务使用受控工具集（如 `git pull`, `npm test`） |
| 1.2 | 多级上下文压缩 | 4-5天 | 工具输出摘要化 + 滑动窗口 + 响应式压缩 |
| 1.3 | lineEditor 稳定性终修 | 2-3天 | 增量渲染全面接入 + resize 处理 |
| 1.4 | 测试覆盖补齐 | 3-4天 | GUI/调度器/附件管理/图片处理 的关键路径测试 |

#### 支柱 2：功能补齐

| # | 任务 | 工时 | 说明 |
|---|------|------|------|
| 2.1 | 会话 Checkpoint / Fork | 3-4天 | `/fork <turn>` |
| 2.2 | 权限作用域允许 | 2-3天 | 会话内同类操作减频确认 |
| 2.3 | Hooks 系统 | 4-5天 | pre/post tool, pre/post compact |
| 2.4 | embedding 记忆检索 | 3-4天 | 可选层，默认关 |

#### 支柱 3：生态扩展

| # | 任务 | 工时 | 说明 |
|---|------|------|------|
| 3.1 | MCP Streamable HTTP | 4-5天 | 远程 MCP 服务器 |
| 3.2 | Linux GUI 自动化基础 | 3-4天 | xdotool/wtype |
| 3.3 | 调度器 webhook | 2-3天 | 任务完成通知 |
| 3.4 | OpenAI 适配器图片支持 | 1-2天 | 确认并实现 |

### 8.2 不做清单

1. **不要建 plugin marketplace** — 生态未到那个阶段，而且会增加运营负担
2. **不要移除 HARNESS_ 兼容层** — 至少保留到下个大版本
3. **不要增加 runtime dep** — 4 个依赖是核心护城河
4. **不要追 Agent Teams** — 多 agent 并行对本地 CLI 不实用

### 8.3 最重要的三件事

如果只能选三件事来做：

1. **调度器权限策略**（修复调度任务无法执行修改操作的致命问题）
2. **多级上下文压缩**（解决长会话质量下降的核心瓶颈）  
3. **lineEditor 稳定性终修 + 测试覆盖补齐**（解决日常使用的"毛刺"和新增代码的回归保护）

---

## 附录 A：从 v0.3.2 到 v0.5.1 的演进总结

| 版本 | 新增 | 移除 | 变化 |
|------|------|------|------|
| v0.3.2 | — | — | 8,500 行, 366 测试 |
| v0.4.0 | 命令拆分, protect, Tavily, editorRender | 无 | 13,500 行 (+5,000), 409 测试 (+43) |
| v0.4.1 | light-agent 更名, 全局 env | harness-agent 二进制 | 14,000 行 |
| v0.4.2 | 交互式工作流改进 | 无 | — |
| v0.5.0 | 多模态, 调度器, GUI 自动化, smoke test | 无 | 17,400 行 (+3,400), 461 测试 (+52) |
| v0.5.1 | MCP 配置测试隔离 | 无 | 当前版本 |

## 附录 B：文件清单（87 个源文件）

```
src/ 目录：66 个 .ts 文件，17,412 行
test/ 目录：50 个 .test.ts 文件，461 测试
docs/ 目录：15 个文档文件
```
