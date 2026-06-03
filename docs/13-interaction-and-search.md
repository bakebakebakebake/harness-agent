# 13 · 当前交互与搜索工作流

> 这页只讲当前版本里别人实际怎么用。

## 1. `/` 命令菜单

- `/` 仍然支持模糊搜索,但排序已经换成更符合直觉的一套:
  - exact 命中最高
  - prefix 命中高于普通模糊命中
  - 命令名命中高于描述命中
  - 危险命令如 `/exit`、`/clear` 默认降权
- 回车会**直接执行当前选项**,不会先把命令回填到输入框里。
- picker 现在会明确显示 `Search:` 搜索行,不用再猜这里能不能搜。
- 列表滚动提示固定为:
  - 顶部 `↑ N earlier`
  - 底部 `↓ M more`
- 单独按 `Esc` 会立刻退出菜单。

## 2. Skill 的使用方式

最顺手的方式是直接在输入框里打:

```text
#obsidian
```

- 输入 `#` 会直接打开 skill picker。
- 选中 skill 后:
  - skill 会挂到**当前这条正在编辑的消息**
  - 不会自动发送
  - 输入框里会显示 `skills: ...`
  - 你可以继续写正文
- `#` 内联选择和 `/skill` 选择现在走同一条挂载链路,所以 badge 会立刻刷新。
- 当输入框为空时,按 `Backspace` 会按加入顺序的反向逐个移除已挂载项。
  当前这套回退同时覆盖:
  - skill
  - `/mcp use <server>` 挂上的 MCP server hint
- 如果输入框里已经写了很多正文:
  - 按 `↑` 会先进入已挂载项区域,不会立刻跳历史
  - 会先落在 `skills:` 行,再往上是 `mcp:` 行
  - `←` / `→` 可在当前行的已挂载项之间切换
  - `Backspace` 会移除当前高亮的那一项
  - `↓` 会按相反方向回到正文输入区
- 这批 skill 只作用于**下一条消息**。发出去后会自动消费掉。

`/skill` 也仍然可用:

```text
/skill
/skill review
/skill remove review
/skill list
/skill disable review
/skill enable review
/skill clear
```

- `/skill` 无参会直接打开“可用 skills”选择器:
  - 选中后立刻挂到下一条消息
  - 不再先进入一个 `Manage skills...` 的中间层
  - 已挂载 skill 的移除更适合直接在输入框里用附件导航完成

当前 skill 会显示这些元数据:

- scope:`global` 或 `project`
- enabled / disabled
- 估算上下文占用:`~123 tok`

repo 级控制文件:

```text
<workdir>/.agents/light-agent.json
```

其中 `disabledSkills` 会让对应 skill:

- 不进 always-on skill catalog
- 不参与自动 skill 检索
- 不出现在 `#` 和 `/skill` 的可选列表里

## 3. `/diff`

当前 `/diff` 不会再直接把整个 repo 的 unified diff 一股脑打印出来。

常见用法:

```text
/diff
/diff --staged
/diff --unstaged
/diff --name-only
/diff lineEditor
```

- `/diff`
  - 先列出 changed files
  - 在 TTY 模式下会先显示一个 diff overview
  - 再选文件看 patch
  - 看完一个 patch 后,可以直接选择回到文件列表或退出 `/diff`
- `/diff --staged`
  - 只看 staged changes
- `/diff --unstaged`
  - 只看未暂存改动
- `/diff --name-only`
  - 只看文件列表
- `/diff <path-fragment>`
  - 先按路径片段过滤,再进入文件列表 / patch

当前重点还是“文件级浏览 + patch drill-down”,还没有做 side-by-side。

## 4. 图片附件

当前图片输入已经挂进同一条输入链路了。

最常见的几种方式:

```text
/image
/image add ./docs/diagram.png
/image paste
```

- `/image add <path>`
  - 把本地图片挂到下一条消息
- `/image paste`
  - 从 macOS 剪贴板导入图片
  - 截图到剪贴板后,也走这条路径
- Finder 拖拽图片到输入框时:
  - 如果终端插入的是图片路径
  - Light-Agent 会直接把它识别成图片附件
  - 不再把这段路径留在正文里

挂载后输入框会显示:

```text
images: a.png, b.png
```

图片和 skill / MCP 一样:

- 只作用于下一条消息
- 发出去后自动清空
- 空输入时 `Backspace` 可逐个回删
- 有正文时可先按 `↑` 进入附件区,再高亮删除

## 5. `/search`

```text
/search light-agent github
/search openai responses api tools
/search latest anthropic release notes
```

当前行为:

1. 有 `TAVILY_API_KEY` 时优先走 Tavily
2. 否则自动降级到 Bing
3. 本地再做一轮重排
4. 输出标题、来源、backend、URL、摘要、日期
5. 在 TTY 模式下可以继续选一个结果,直接抓页面正文

如果你主要使用 npm 安装版,更适合直接配全局搜索设置,而不是每个项目都写
一份 `.env`。

当前优先级:

1. shell env
2. `<workdir>/.env`
3. `~/.light-agent/env`

可直接通过命令配置:

```text
/config
/config search
/config search backend auto
/config search backend tavily
/config search tavily-key
/config search clear-tavily-key
```

- `/config` 和 `/config search` 在 TTY 模式下都支持 picker:
  - 可以直接选 runtime config 或 search config
  - search config 里可以直接选 backend / set key / clear key

补充一点:

- DeepSeek V4 走官方 thinking 语义时,CLI 的 `thinking high` 会映射到
  DeepSeek 的最高档 `reasoning_effort=max`
- `thinking low/medium` 会映射到 DeepSeek 的 `high`
- 某些第三方 OpenAI 兼容网关如果不接受这些字段,会自动回退到不带
  DeepSeek thinking 扩展字段的请求,避免直接 400

排序倾向:

- 技术类 query 会更偏向官方文档、主仓库、维护者来源
- “latest / today / recent” 这类 query 会更偏向新结果
- 输出默认保留来源和 backend,方便人工判断可信度

如果你在切换模型后怀疑“模型名能选上,但实际不可用”,现在可以直接跑:

```text
/model test
/model test gpt-5-mini
```

它会检查两件事:

1. 当前 baseURL 的模型目录接口是不是正常返回 API JSON
2. 当前模型能不能实际完成一次最小回复

这对排查“代理站返回网页 HTML,但 CLI 误以为请求成功”这类问题很有用。

现在在 onboarding 和 `/profile new` 里,只要你先填好了 provider、API key 和 baseURL, CLI 就会立刻尝试抓取对应模型目录:

- TTY 下优先走 picker 选择
- 仍然保留 `Enter custom model`
- 非 TTY 或抓取失败时,继续回退到手工输入

对于 OpenAI 兼容网关,现在还有一层自动恢复:

- 如果你填的是站点根地址,例如 `https://example.com`
- `/models` 或 `/chat/completions` 返回的是网站 HTML
- Light-Agent 会自动重试标准的 `/v1/models` 和 `/v1/chat/completions`

所以像某些代理站“官网地址可打开,真正 API 在 `/v1` 下”这种情况,现在不需要你先手工改配置才能测出来。`/model test` 也会把实际命中的 catalog URL 打出来,方便确认恢复是否生效。

模型工具层也同步有:

- `web_search`
- `web_fetch`

## 6. `/mcp` 与 `/protect`

`/mcp` 现在会显示:

- server 名称
- `connected` / `idle`
- 当前已加载 tool 数
- command / args / scope / description
- `/mcp` 无参时会进入 picker,可以直接把某个 server 挂到**下一条消息**
- `/mcp use <server>` 也可以显式挂载
- 挂载后输入框会显示 `mcp: ...`
- 和 skill 一样,发出去后会自动消费掉

`/protect` 用来保护模型动作:

```text
/protect
/protect list
/protect add command rm -rf
/protect rm command rm -rf
/protect add path .env
/protect rm path .env
```

这套规则只拦**模型调用**:

- `bash`
- `shell`
- `edit`
- `write`

你自己手打的 `!` 命令不受它影响。

另外,`!` 现在会临时释放 raw stdin,把真实前台 TTY 交给子进程,并改成
前台非 interactive shell + 显式加载 rc 文件的方式执行,所以
`npm run dev` 这类长期运行命令更不容易再出现 `suspended (tty input)`
或 `suspended (tty output)`。

## 7. `/schedule` 与 `/gui`

这两块是新增能力:

```text
/schedule
/schedule add
/schedule status
/gui
/gui doctor
```

- `/schedule`
  - 管理本机后台任务
  - 第一版支持 `once`、`daily`、`weekly`
  - 状态、pid、log 都落在 `~/.light-agent/scheduler/`
- `/gui`
  - 列出当前已接通的 macOS GUI action
  - `doctor` 会检查 `osascript` / `System Events` 权限状态

如果只是想先了解怎么用,更详细的说明在:

- `docs/14-multimodal-and-image-input.md`
- `docs/15-scheduler-and-gui-automation.md`

## 8. `/debug` 与日志

```text
/debug on
/debug off
```

- 打开后会把结构化日志写到:

```text
~/.light-agent/logs/light-agent.log
```

- 当前重点记录:
  - slash 菜单排序结果
  - 输入框菜单打开/关闭
  - `/diff` 文件计数
  - `/skill` 挂载状态
  - `/search` 结果和抓取 URL
  - 顶层异常与未处理错误

## 9. CI

仓库已接入 GitHub Actions:

- push 到 `main`
- pull request
- `v*` tag

都会跑:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

## 10. 当前实现结构

- `src/commands/registry.ts`
  - 负责 slash 菜单召回、排序、dispatch
- `src/commands/interactionCommands.ts`
  - 负责 `/diff`、`/search`、`/skill`、`/image`、`/debug`
- `src/commands/scheduleCommands.ts`
  - 负责 `/schedule`
- `src/commands/guiCommands.ts`
  - 负责 `/gui`
- `src/ui/lineEditor.ts`
  - 负责编辑器状态机、history、rewind、interrupt、菜单开关
- `src/ui/editorRender.ts`
  - 负责输入框视图拼装、换行、badge 展示、redraw 判断
- `src/ui/keys.ts`
  - 直接解析 raw stdin,这样单独 `Esc` 可以立刻生效
- `src/util/web.ts`
  - 负责 Tavily/Bing 搜索后端、重排和页面抓取
- `src/util/images.ts`
  - 负责图片校验、拖拽路径识别、剪贴板桥接、visionMode 本地拦截
- `src/scheduler/`
  - 负责 jobs.json、runner、run log、后台执行
- `src/gui/macos.ts`
  - 负责 Finder / Notes / Safari / System Events 的脚本白名单桥接
- `src/ext/repoConfig.ts`
  - 负责 repo 级 `disabledSkills`、`blockedCommands`、`protectedPaths`
