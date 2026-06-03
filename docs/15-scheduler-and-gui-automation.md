# 15 · Scheduler 与 macOS GUI 自动化

> 这页讲两个新增能力:本机后台任务和 macOS GUI 自动化。

## 1. `/schedule`

第一版是**本机后台 runner**。

支持的调度类型:

- `once`
- `daily`
- `weekly`

当前命令:

```text
/schedule
/schedule add
/schedule list
/schedule show <id>
/schedule remove <id>
/schedule pause <id>
/schedule resume <id>
/schedule run-now <id>
/schedule status
/schedule stop-runner
```

无参 `/schedule` 在 TTY 下会先给一个 picker:

- `Add job`
- `Runner status`
- 已有 job 列表

点进某个 job 之后,会继续给动作选择:

- `Show details`
- `Run now`
- `Pause / Resume`
- `Remove job`

## 2. `/schedule add` 的输入

当前会交互式询问:

1. `Job name`
2. `Prompt`
3. `Schedule type`
4. `Schedule spec`

spec 规则:

- `once`
  - ISO datetime,例如 `2026-06-03T20:30:00+08:00`
- `daily`
  - `HH:MM`,例如 `09:30`
- `weekly`
  - `mon@09:30`

## 3. Scheduler 存储位置

```text
~/.light-agent/scheduler/jobs.json
~/.light-agent/scheduler/runs/
~/.light-agent/scheduler/runner.pid
~/.light-agent/scheduler/runner.log
```

行为说明:

- 新增/恢复任务时,会尝试启动 detached runner
- `run-now` 会立刻跑指定 job
- `once` 任务成功跑完后会自动停用
- 后台任务会生成独立 session,方便之后 `/resume`

## 4. 背景执行边界

当前后台任务会复用现有 agent loop,但它没有实时人工确认。

因此:

- 读类能力正常可用
- 需要确认的高风险动作默认会被拒绝

这让第一版更稳,也更符合“后台 job 以保守执行为主”的定位。

## 5. `/gui`

`/gui` 先提供可见性,告诉你现在有哪些 macOS GUI action 已经接通:

```text
/gui
/gui list
/gui apps
/gui doctor
```

- `/gui list`
  - 列出所有支持的 `app.action`
- `/gui apps`
  - 只列 app
- `/gui doctor`
  - 检查 `osascript` 和 `System Events` 权限情况

无参 `/gui` 在 TTY 下也会先给一个 picker:

- `List actions`
- `List apps`
- `Run doctor`

## 6. `macos_gui` 工具

模型侧使用的是结构化工具:

```json
{
  "app": "finder",
  "action": "reveal_path",
  "args": {
    "path": "/tmp/demo.txt"
  }
}
```

当前支持这些 app/action:

- Finder
  - `activate`
  - `open_path`
  - `reveal_path`
  - `new_folder`
- Notes
  - `activate`
  - `create_note`
  - `append_to_note`
  - `list_folders`
- Safari
  - `activate`
  - `open_url`
  - `list_tabs`
  - `focus_tab`
- System
  - `activate_app`
  - `keystroke`
  - `menu_click`

## 7. 安全边界

`macos_gui` 是高风险工具:

- 会走现有 confirmation gate
- 预览里会显示要执行的动作和脚本
- 只允许白名单里的 action

当前版本还没有做视觉驱动 backend,但已经把顶层入口和命令分开了,后面可以继续往里加:

- vision backend
- iOS / simulator backend
- 更丰富的 app action catalog
