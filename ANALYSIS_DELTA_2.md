# Light-Agent v0.5.1 — 增量分析与规划更新

> **项目已更名：Harness-Agent → Light-Agent（`light-agent-cli` / `light-agent`）**
> 对比基准：v0.4.0（ANALYSIS_DELTA.md）→ v0.5.1（当前）
> 生成日期：2026-06-02

---

## 一、本次迭代的变化概要

### 1.1 版本跃迁

| 维度 | v0.4.0 | v0.5.1 | 变化 |
|------|--------|--------|------|
| 项目名 | Harness-Agent | **Light-Agent** | 更名 |
| 包名 | `harness-agent` | **`light-agent-cli`** | 更名 |
| 二进制 | `harness-agent` | **`light-agent`** | 更名 |
| 源文件数 | ~48 | ~66 | +18 个新文件 |
| 代码行数 | ~13,500 | ~17,400 | +~3,900 行 |
| 测试数 | 409 / 44 文件 | **461 / 50 文件** | +52 测试 / +6 文件 |
| 版本号 | 0.4.0 | **0.5.1** | 跨越 4 个小版本 |

### 1.2 新增核心目录和文件

```
src/
  scheduler/         ← 全新：调度器子系统
    types.ts           ScheduledJob / SchedulerStore / SchedulerRunRecord
    store.ts           JSON 持久化、nextRunAt 计算、cron 解析
    runner.ts          子进程守护进程、30s 轮询、runScheduledJob
  gui/
    macos.ts           ← 全新：macOS GUI 自动化
                       AppleScript/JXA 桥接，15 个 action
  tools/
    macosGui.ts        ← 全新：macos_gui 工具（high risk / exclusive）
  model/
    smoke.ts           ← 全新：模型连通性冒烟测试
  commands/
    scheduleCommands.ts ← 全新：/schedule 命令（9 个子命令）
    guiCommands.ts      ← 全新：/gui 命令（list / apps / doctor）
  util/
    images.ts          ← 全新：图片处理
  pendingContext.ts    ← 全新：统一的附件管理系统
                        skill / MCP / image 三类附件
  config.ts           ← 重写：env 加载链、全局 env、更名兼容
```

### 1.3 新增文档

```
docs/13-interaction-and-search.md   ← 全新：交互和搜索工作流
docs/14-multimodal-and-image-input.md  ← 全新：多模态和图片输入
docs/15-scheduler-and-gui-automation.md  ← 全新：调度器和 GUI 自动化
```

### 1.4 总体评价

> **这是项目迄今为止最大的一次功能迭代。三个全新子系统（多模态、调度器、GUI 自动化）在一条 release 中落地，同时完成了品牌更名、env 兼容层、文档重建。这是一次从"编码辅助工具"向"通用 agent 平台"的跃迁。**

---

## 二、逐项变更分析

### 2.1 品牌更名与环境兼容层

**变更**：项目从 `harness-agent` 更名为 `light-agent-cli`（二进制 `light-agent`）。

**核心改动**：
- 环境变量：`HARNESS_*` → `LIGHT_AGENT_*`（旧变量作为 fallback 保留）
- 数据目录：`~/.harness-agent` → `~/.light-agent`（旧目录自动检测兼容）
- 二进制名：`harness-agent` → `light-agent`
- `preferredGlobalHome()` 函数优先读 `LIGHT_AGENT_HOME`，fallback 到 `HARNESS_HOME`，再检测 `~/.light-agent` 和 `~/.harness-agent`

**env 加载链重写**：
```
1. Shell 原生 env 变量（最高优先级，protected keys）
2. 全局 env 文件（~/.light-agent/env），不覆盖 shell 已有值
3. 项目 .env 文件，覆盖全局 env 中加载的值（但不覆盖 shell 原生）
```

**评估**：
- ✅ **迁移路径完整**：`envValue()` 函数统一处理双前缀，旧配置可无缝迁移
- ✅ 全局 env 文件是合理的改进——不再需要在每个项目放 `.env`
- ✅ `preferredGlobalHome()` 检测机制避免了数据丢失
- ⚠️ 更名对社区文档和问题追踪 URL 有影响（repo 从 `harness-agent` 变为 `light-agent`）
- ⚠️ `HARNESS_` 前缀的在代码中仍有残留（`loadDotEnv` 等），长期建议统一

### 2.2 多模态 / 图片输入

**变更**：全新子系统，支持 4 种图片输入路径。

| 入口 | 实现 |
|------|------|
| `/image add <path>` | 通过 `validateImagePath()` 验证后挂载 |
| `/image paste` | 调用 `importClipboardImage()` 通过 JXA 从剪贴板读取 |
| `cmd+v` | 识别只有图片的粘贴事件，自动走剪贴板导入路径 |
| Finder 拖拽 | 通过 `detectDroppedImagePaths()` 从 shell token 检测文件路径 |
| 直接写图片路径 | 通过 `consumeImagePathsFromText()` 提交前自动识别 |

**技术实现**：
- `util/images.ts`（322 行）：
  - `validateImagePath()`：MIME 类型校验、大小限制（单文件 20MB，总计 40MB）
  - `importClipboardImage()`：通过 macOS JXA `NSPasteboard` 读取剪贴板，TIFF 自动转 PNG
  - `consumeImagePathsFromText()`：解析 shell token，提取图片路径，从正文中移除
  - `detectDroppedImagePaths()`：识别拖拽路径
  - `listImageFiles()`：递归查找工作目录中的图片文件
  - `enforceVisionMode()`：根据 `visionMode` 配置（auto/on/off）决定是否允许图片

- `model/anthropic.ts`：新增 `image` content block 支持，通过 `readImageAsBase64()` 编码为 base64 发送

- `config.ts` 新增：
  - `parseVisionMode()`：解析 `LIGHT_AGENT_VISION` 环境变量
  - `visionMode` 配置项（auto / on / off）

**评估**：
- ✅ **完整的多模态 pipeline**：从输入检测→验证→剪贴板导入→base64 编码→发送到 API
- ✅ clipboard 导入使用 JXA 而非 AppleScript，效率更高
- ✅ `consumeImagePathsFromText()` 的 shell token 解析实现是亮点——正确处理了引号、转义、空格
- ✅ `enforceVisionMode()` 在 auto 模式下通过 `modelSupportsVision()` 检测模型能力
- ⚠️ **仅支持 Anthropic 的 base64 图片**（代码中列出了 `image` block 类型，但 OpenAI 适配器未确认是否同样支持）
- ⚠️ 剪贴板导入需要 macOS Accessibility 权限，首次使用需用户授权
- ⚠️ 图片不会出现在 transcript 回放中（base64 数据不持久化）

### 2.3 调度器子系统

**变更**：全新子系统，完整的后台任务调度器。

**架构**：

```
cli.ts 中 /schedule 命令
  → scheduler/store.ts (JSON 持久化)
     → scheduler/runner.ts (子进程守护进程)
        → 每 30 秒轮询 runDueJobs()
           → runScheduledJob(job)
              → 独立 runAgentLoop() + denyingConfirmer
              → 运行结果持久化为 SchedulerRunRecord
```

**调度类型**：
- `once`：ISO 8601 时间点执行一次
- `daily`：每日固定时间（`HH:MM`）
- `weekly`：每周固定日+时间（`mon@09:30`）

**核心设计决策**：
1. **子进程守护进程**：`startSchedulerDaemon()` 通过 `spawn(detached: true, stdio: "ignore")` 启动独立进程
2. **非交互式权限**：所有调度任务使用 `denyingConfirmer` + `PermissionPolicy` 默认策略运行
3. **PID 文件**：`runner.pid` 用于检测守护进程存活状态
4. **运行记录**：每个 job 的运行记录以 JSONL 格式保存在 `scheduler/runs/{jobId}.jsonl`
5. **nextRunAt 计算**：`computeNextRunAt()` 针对 daily/weekly 正确处理跨天和跨周边界

**`/schedule` 命令（9 个子命令）**：
```
add / list / show / remove / pause / resume / run-now / status / stop-runner
```

**评估**：
- ✅ 这是从"交互式 REPL"到"长期运行 agent 平台"的重要一步
- ✅ `denyingConfirmer` 用于调度任务是正确的设计——非交互模式下不能询问用户
- ✅ 30 秒轮询间隔是合理的默认值
- ✅ `nextRunAt` 更新逻辑正确处理了一次性任务的自动禁用
- ⚠️ 守护进程没有日志轮换（`runner.log` 会持续增长）
- ⚠️ 守护进程没有心跳或自恢复机制（crash 后不会自动重启）
- ⚠️ `denyingConfirmer` + `PermissionPolicy` 的组合在调度任务中意味着**所有 high-risk 操作（bash）被拒绝**，这将严重限制调度任务的能力
- ⚠️ 没有配置守护进程检查间隔的环境变量（`LIGHT_AGENT_SCHEDULER_INTERVAL`）

### 2.4 macOS GUI 自动化

**变更**：全新子系统，通过结构化 AppleScript 桥控制 macOS 应用。

**支持的 app/action 对（15 个）**：

| App | Action | 说明 |
|-----|--------|------|
| `finder` | `activate` | 激活 Finder |
| `finder` | `open_path` | 在 Finder 中打开路径 |
| `finder` | `reveal_path` | 在 Finder 中显示路径 |
| `finder` | `new_folder` | 创建文件夹 |
| `notes` | `activate` | 激活 Notes |
| `notes` | `create_note` | 创建笔记 |
| `notes` | `append_to_note` | 追加内容到笔记 |
| `notes` | `list_folders` | 列出笔记文件夹 |
| `safari` | `activate` | 激活 Safari |
| `safari` | `open_url` | 打开 URL |
| `safari` | `list_tabs` | 列出标签页 |
| `safari` | `focus_tab` | 聚焦标签页 |
| `system` | `activate_app` | 激活任意应用 |
| `system` | `keystroke` | 发送按键 |
| `system` | `menu_click` | 点击菜单项 |

**技术实现**：
- `gui/macos.ts`（267 行）：`buildMacosGuiScript()` 按 app+action 生成 AppleScript 字符串
- `tools/macosGui.ts`：作为 high-risk tool 注册
- `buildMacosGuiScript()` 不直接执行，而是返回 `{ language, script, summary }` 结构
- `runMacosGuiAction()` 通过 `spawnSync("osascript")` 执行
- `describeAction()` 在权限确认前展示完整的 AppleScript 源码

**评估**：
- ✅ **结构化而非自由文本的 AppleScript 生成**——不是把模型输出直接丢给 osascript，而是通过 switch-case 模板生成，安全性更好
- ✅ `describeAction()` 显示完整脚本源码，让用户知道具体要执行什么
- ✅ `doctorMacosGui()` 提供了诊断支持
- ⚠️ 仅 macOS 可用（`process.platform !== "darwin"` 时返回"unsupported"）
- ⚠️ 需要 Accessibility / Automation 权限，首次使用需要用户在系统设置中授权
- ⚠️ Action 集合有限（15 个），无法覆盖全部 macOS 自动化场景
- ⚠️ `keystroke` action 无法模拟组合键（如 `Cmd+Shift+P`）

### 2.5 附件管理系统

**变更**：将 skill / MCP / image 三类附件统一管理。

**新文件** `pendingContext.ts`（155 行）：

```typescript
type PendingAttachmentKind = "skill" | "mcp" | "image";

interface PendingAttachment {
  kind: PendingAttachmentKind;
  label: string;
  context?: string;    // 注入到 system prompt 的文本
  image?: PendingImageBlock;  // 图片内容 block
}
```

**核心函数**：
- `pushPendingAttachment()` / `removePendingAttachment()` / `popPendingAttachment()`
- `clearPendingAttachments()` / `clearPendingAttachmentsByKind()`
- `attachmentBadges()` / `groupPendingAttachments()`
- `pendingUserContent()`：组装最终的消息 content blocks（文本 + 图片）

**评估**：
- ✅ 统一管理显著简化了 `cli.ts` 中的状态逻辑
- ✅ `attachmentBadges()` 按优先顺序显示：images → mcp → skills
- ✅ `groupPendingAttachments()` 支持 UI 按类型分组渲染
- ⚠️ attachments 在 session serialization 中的持久化状态未明确定义

### 2.6 模型冒烟测试

**变更**：新文件 `model/smoke.ts`（84 行）。

**功能**：在 onboarding 阶段测试模型连通性：
1. 调用 `fetchModels()` 获取模型目录
2. 发送一条 "Reply with exactly OK" 的测试消息
3. 捕获流式响应的 text、reasoning、tool_use、usage 信息
4. 返回 `ModelSmokeResult` 报告

**评估**：
- ✅ 20 秒超时，避免长时间等待
- ✅ 同时测试了 catalog API 和 stream API
- ✅ 对 reasoning 和 tool_use 的支持增强了诊断能力
- ⚠️ 目前未被 onboarding 流程实际使用（定义了函数但未集成到 `collectOnboarding` 中）

### 2.7 行编辑器增强

**变更**：`lineEditor.ts` 和 `ui/editorRender.ts` 显著改进。

**新增能力**：
- `#` 快捷键打开 skill picker（类似 `@` 文件菜单）
- `cmd+v` 识别为图片粘贴（macOS 剪贴板导入）
- 附件区的 ↑/↓ 导航（当输入框为空时，Backspace 移除附件）
- 输入框非空时，↑ 进入附件区域（不跳历史）
- Badge 系统增强：同时显示 skills / MCP / images 三类标记

**评估**：
- ✅ **`#` shortcut 是很好的 UX**——输入 `#obsidian` 一步完成 skill 挂载，不用 `/skill` 再选
- ✅ 附件区的导航逻辑清晰：`↑` 从正文进入附件区、空内容 `Backspace` 移除附件
- ✅ `editorRender.ts` 已支持 attachments badges 渲染
- ⚠️ `#` picker 与 gitmoji / tag 系统可能存在快捷键冲突

### 2.8 新增文档

**变更**：3 篇新 docs + 现有文档更新。

- **`docs/13-interaction-and-search.md`**：交互和搜索工作流（完整的操作指南）
- **`docs/14-multimodal-and-image-input.md`**：多模态和图片输入（4 种入口方式、输入框表现）
- **`docs/15-scheduler-and-gui-automation.md`**：调度器和 GUI 自动化

**评估**：
- ✅ 文档质量高，贴近实际使用场景
- ✅ `docs/13` 作为交互指南填补了之前只有"架构参考"没有"用户指南"的空白
- ✅ 这三个文档标志着 docs/ 从"架构参考"向"用户手册"的转型

### 2.9 此前分析中建议的完成情况

| 建议 | 来源 | v0.4.0 | v0.5.1 |
|------|------|--------|--------|
| P1-3: 流式渲染稳定性 | ANALYSIS.md | ❌ 未触及 | ❌ 未触及 |
| P2-1: 对话 Checkpoint / Fork | ANALYSIS.md | ❌ 未触及 | ❌ 未触及 |
| P2-2: MCP Streamable HTTP | ANALYSIS.md | ❌ 仍仅 stdio | ❌ 仍仅 stdio |
| P2-3: 作用域允许权限 | ANALYSIS.md | 🏗️ 目录级保护 | ❌ 未触及 |
| P2-4: 子 Agent 隔离增强 | ANALYSIS.md | ❌ 未触及 | ❌ 未触及 |
| P2-5: 多级上下文压缩 | ANALYSIS.md | ❌ 未触及 | ❌ 未触及 |
| P3-1: Embedding 检索 | ANALYSIS.md | ❌ 未触及 | ❌ 未触及 |
| P3-3: Vim 模式 | ANALYSIS.md | ❌ 未触及 | ❌ 未触及 |
| lineEditor 增量渲染 | ANALYSIS_DELTA.md | 🏗️ 架构准备 | ✅ 已改善但闪烁问题未完全解决 |

---

## 三、项目状态重新评估

### 3.1 功能成熟度矩阵

| 功能维度 | 成熟度 | 说明 |
|---------|--------|------|
| **核心 Agent 循环** | 🟢 生产级 | 稳定的 ReAct loop，366+ 测试覆盖 |
| **工具系统** | 🟢 生产级 | 20 个工具，风险/并发分类完整 |
| **权限系统** | 🟡 可用 | 4 模式 + denial tracking + repo 保护配置 |
| **记忆系统** | 🟡 可用 | 3层结构完整，无 embedding |
| **多模态输入** | 🟢 生产级 | 4 种入口，全 pipeline 完整 |
| **调度器** | 🟡 可用 | once/daily/weekly，守护进程模式 |
| **GUI 自动化** | 🟡 可用（macOS only）| 15 个 action，AppleScript 桥 |
| **MCP** | 🟡 可用 | stdio only，状态可视化 |
| **Web 搜索** | 🟡 可用 | Tavily + Bing fallback |
| **可扩展性** | 🟡 可用 | Skills / 自定义命令 / MCP |
| **会话管理** | 🟡 可用 | 存档/恢复，无 checkpoint/fork |
| **上下文管理** | 🔴 初级 | 仅单层 compact，无滑动窗口 |
| **子 Agent** | 🔴 初级 | 单层隔离，无 worktree |
| **Hooks 系统** | 🔴 不存在 | 文档中提到但未实现 |
| **Vim 模式** | 🔴 不存在 | |
| **远程控制** | 🔴 不存在 | |

### 3.2 项目定位演变

```
v0.3.2:  "好用的编码 Agent CLI"          ← 对标 Claude Code / Codex CLI
v0.4.0:  "安全可控的生产级编码 Agent"      ← 权限系统增强
v0.5.1:  "通用自动化 Agent 平台"           ← 调度器 + GUI + 多模态
```

这不是单纯的编码 Agent 了。调度器让它能做定时任务，GUI 自动化让它能操作桌面应用，多模态让它能看图。它正在变成一个**面向开发者的通用自动化工作台**。

### 3.3 需要关注的风险

1. **功能膨胀风险**：17,400 行 TypeScript，从 ~8,500 行翻了一倍。4 个 runtime dep 没变（这是好事），但复杂度指数级增长。

2. **macOS 锁定风险**：GUI 自动化（macOS only）、图片剪贴板（JXA，macOS only）正在将项目锁定在 macOS 生态。需要明确的跨平台策略。

3. **调度器安全风险**：调度任务运行在 `denyingConfirmer` 模式，这意味着：
   - 所有 bash/shell/edits 都被拒绝
   - 调度任务只能做 read + memory + web_search 操作
   - 用户预期的"定时跑测试"场景无法工作（因为 git pull/npm test 都被拒绝）
   - 需要**更细致的调度器权限策略**

4. **品牌更名冲击**：从 `harness-agent` 到 `light-agent`，GitHub 仓库变更，npm 包变更，现有用户需要迁移。

---

## 四、更新后的路线图

### 4.1 建议调整为三个支柱

基于项目已变成"通用自动化 Agent 平台"的新定位，建议将路线图组织为三个并行支柱：

#### 支柱 A：核心体验标准化（保持竞争力）

| 任务 | 优先级 | 说明 |
|------|--------|------|
| 多级上下文压缩 | **高** | 这是最大的功能差距，Claude Code 有 5 层 |
| 会话 Checkpoint / Fork | **高** | 基础会话管理功能 |
| lineEditor 稳定性终修 | **高** | 增量渲染 + 闪烁修复 |
| Vim 模式 | 中 | 开发者标配需求 |

#### 支柱 B：调度器安全增强（新能力深化）

| 任务 | 优先级 | 说明 |
|------|--------|------|
| 调度器权限策略 | **高** | 允许调度任务使用某些受控工具（如 git pull, npm test） |
| 调度器运行历史 UI | 中 | `/schedule history <id>` 查看执行记录 |
| 调度器守护进程自恢复 | 中 | crash 后自动重启 |
| 守护进程间隔可配置 | 低 | `LIGHT_AGENT_SCHEDULER_INTERVAL` |
| 日志轮换 | 低 | `runner.log` 自动归档 |

#### 支柱 C：跨平台与生态（长期差异化）

| 任务 | 优先级 | 说明 |
|------|--------|------|
| Linux GUI 自动化 | **高** | 考虑 DBus / xdotool / wtype |
| Windows GUI 自动化 | 中 | AutoIT 或 WinAppDriver |
| MCP Streamable HTTP | 中 | 远程 MCP 服务器支持 |
| Hooks 系统 | 中 | pre/post tool call hooks |
| 调度器 webhook 通知 | 低 | 任务完成时通知 |

### 4.2 不应做的事情

1. **不要追 agent teams 风**：Claude Code 的 Agent Teams 需要 16 个 Opus 实例并行工作，这种规模对本地 CLI 不实用。
2. **不要建 plugin marketplace**：生态还没到那个阶段。
3. **不要移除 HARNESS_ 兼容层**：现有用户依赖它，至少保留到下个大版本。
4. **不要增加更多 runtime dep**：4 个依赖的简洁性是核心优势。

### 4.3 竞品重新评估

| 维度 | Light-Agent v0.5.1 | Claude Code | Codex CLI | OpenCode |
|------|--------------------|-------------|-----------|----------|
| 调度器 | ✅ 有（守护进程） | ✅ 有（Scheduled Tasks） | ❌ 无 | ❌ 无 |
| 多模态 | ✅ 有（图片输入） | ✅ 有 | ✅ 有 | ❌ 无 |
| GUI 自动化 | ✅ 有（macOS） | ✅ 有（Browser Use） | ✅ 有（Chrome ext） | ❌ 无 |
| 子 Agent | ❌ 无 worktree | ✅ Git worktree + Teams | ✅ Multi-agent | ✅ Scout agent |

Light-Agent 在**调度器**和**本地 GUI 自动化**方面是独特的——Claude Code 和 Codex CLI 都没有本地守护进程模式的调度器。这是值得保持的差异化方向。

---

## 五、结论

### 5.1 一句话

> **Light-Agent v0.5.1 已经超越了"编码 Agent"的初始定位，成为一个面向开发者的通用自动化平台。三个新子系统（多模态、调度器、GUI 自动化）在一条 release 中交付，显示了团队的交付能力。下一阶段的核心挑战是如何在功能扩张的同时保持架构简洁性和跨平台兼容性。**

### 5.2 三个最优先事项

1. **多级上下文压缩**——长会话质量仍然是最大的用户体验痛点
2. **调度器权限策略**——让调度任务真正可用的关键堵点
3. **会话 Checkpoint / Fork**——基础会话管理功能的最后一块拼图

### 5.3 需要更新哪些文件

| 文件 | 更新内容 |
|------|---------|
| `AGENT.md` | 项目名 / 版本号 / 测试数 / 架构总览 / 新增模块说明 |
| `README.md` | 项目名 / 安装指令 / 新功能文档链接 |
| `.env.example` | `LIGHT_AGENT_*` 环境变量 / `VISION_MODE` / 全局 env 说明 |
| `docs/13-interaction-and-search.md` | 补充 `/schedule` 和 `/gui` 相关交互说明 |
