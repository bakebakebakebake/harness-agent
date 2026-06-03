# 14 · 多模态与图片输入

> 这页只讲当前版本里图片怎么进到下一条消息。

## 1. 支持的入口

当前支持 4 种方式:

- `/image add <path>`
- `/image paste`
- `cmd+v` 直接粘贴当前 macOS 剪贴板图片
- Finder 拖拽本地图片到输入框
- 在问题里直接写图片路径

如果你在终端里直接按 `cmd+v`, Light-Agent 现在会把“只有图片、没有文本内容”的粘贴识别成图片附件导入,效果和 `/image paste` 一样。

如果你把一个真实存在的图片路径直接写进输入框里, Light-Agent 也会在提交前把它识别成图片附件。像 Finder 拖拽进来的路径,或者这种带转义空格的路径:

```text
/Users/xjf/Library/Mobile\ Documents/.../wallpaper.png 这张图里是什么?
```

都会在提交前自动把图片挂到下一条消息里,剩下的文字继续作为问题正文发送。

## 2. 输入框里的表现

- 图片不会直接塞进正文 buffer。
- 成功挂载后,输入框会显示:

```text
images: a.png, screenshot.png
```

- 这批图片只作用于**下一条消息**。
- 消息发出后会自动清空。

移除方式和 skill / MCP 一致:

- 空输入时按 `Backspace`
- 已经写了正文时,先按 `↑` 进入附件区
- `←` / `→` 切换图片
- `Backspace` 删除当前高亮图片

## 3. `/image` 命令

```text
/image
/image add ./docs/diagram.png
/image paste
/image list
/image remove diagram.png
/image clear
```

说明:

- `/image` 在 TTY 下会先给出一个 picker:
  - `Paste from clipboard`
  - `List attached images`
  - `Remove one attached image`
  - `Clear attached images`
  - 当前 workdir 内扫到的图片文件
- `/image paste` 会把剪贴板图片落到:

```text
~/.light-agent/tmp/images/
```

- `/image list` 看当前这条消息已经挂了哪些图片
- `/image clear` 一次性清空当前图片附件

## 4. 拖拽行为

终端拖拽图片时,很多情况下会插入本地路径字符串。

当前处理规则:

- 如果这段插入内容能被识别成一个或多个真实存在的图片路径
- 它们就会直接变成图片附件
- 不再留在正文里

如果不是图片路径,仍然按普通文本输入处理。

## 5. 模型能力与 `visionMode`

当前 profile/config 支持:

```text
visionMode = auto | on | off
```

含义:

- `auto`
  - 按 provider/model 名称做一层本地能力判断
  - 看起来不支持图片时,提交前直接拦截
- `on`
  - 强制允许发图片
- `off`
  - 本地直接阻止图片发送

当前还会做这些校验:

- 文件必须存在
- 必须可读
- MIME 只接受:
  - `image/png`
  - `image/jpeg`
  - `image/webp`
  - `image/gif`
- 单图和总图片大小都有本地上限

## 6. Provider 发送方式

- Anthropic:
  - 会把本地图片读成 base64 image block
- OpenAI-compatible:
  - 会转成 `image_url` data URL

历史 transcript 里如果某条 user message 带了图片,现在也会明确显示一个
`[image] filename (source)` 行,方便回看。
