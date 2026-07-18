# 报告组件库：资产清单与拼装配方

固定资产放在 `<skill-dir>/assets/` 下，**按名取用、命令拼装**——不要通过模型逐字重打这些内容。生成正文内容和图的 JSON 数据；只有需要偏离默认基线时才增加定制 CSS。

**组件库不是固定页面模板**：正文结构按问题组织，但默认复用现有排版和组件。token 取值可以在确有需要时整体替换成暗色或其他主题（变量名不变，组件自动跟随）。

## 资产清单（命名获取）

| 资产 | 内容 | 拼进哪里 |
|---|---|---|
| `assets/tokens.css` | design token 基准色板（暖纸面 + 炭墨 + 珊瑚主色 + 青/琥珀强调，与 session-compound 同源） | `<style>` 开头 |
| `assets/components.css` | 页面与排版基线，以及文件树 `file-tree`、锚点徽章 `anchor`、提示卡 `callout`（`.warn`/`.danger`）、图表容器 `fig` | `<style>` |
| `assets/renderers.js` | 纯函数 SVG 渲染器：`renderSequenceSvg`（时序图）、`renderFlowSvg`（分层流程图/状态图），含 `escapeXml`、中英文宽度估算 | `<script>` 开头 |
| `assets/bootstrap.js` | 读取安全嵌入的图形 JSON，并调用固定 SVG 渲染器 | 正文之后的受限脚本 |

## 拼装：scripts/assemble.sh

默认生成 `body 片段`与 `figures.json` 两个文件，并把 custom.css 参数传空。正文只能包含结构化 HTML、经过转义的仓库文本和图容器，不能包含脚本或事件处理器。只有偏离固定页面基线能明确改善当前理解问题时，才额外写 `custom.css`：

```sh
sh <skill-dir>/scripts/assemble.sh /tmp/docent-body.html /tmp/docent-<主题slug>.html "" "<报告标题>" "<lang>" /tmp/docent-figures.json
```

`<skill-dir>` 是本 skill 的安装目录绝对路径，由派遣方在任务里提供——执行前必须替换成实际路径，不能照抄占位符。第 3~5 参可选：确需定制时把第 3 参换成 CSS 文件路径；第 5 参 `lang` 默认 `zh`，**报告语言不是中文时必须显式传**（如 `en`），与"报告语言跟随对话语言"的硬性约束对齐。标题会做 HTML 转义；输出路径不得与任何输入相同（脚本会拒绝）。

脚本会验证正文与定制 CSS、为图形 JSON 做安全序列化、注入内容安全策略，再把四件固定资产拼成完整文档。不要自己手拼文档骨架、在正文加入脚本或重打资产内容。没有图时可以省略最后一个参数。

## 渲染器数据契约

```text
renderSequenceSvg({
  participants: [{ id, label, anchor?, href? }],
  messages: [{ from, to, label, kind?: "return", anchor?, href? }],   // from === to 画自环
})

renderFlowSvg({
  layers: [[{ id, label, anchor?, href?, kind?: "decision" | "terminal" }]],  // 每层一行，自动横向居中
  edges: [{ from, to, label? }],
})
```

`anchor` 是可见的 `文件:行号`，`href` 是报告内部章节 id，例如 `#sec-entry`。渲染器只接受以 `#` 开头的内部链接，其他值会被忽略。

正文放图容器：

```html
<figure class="fig"><div id="fig-main"></div><figcaption>FIG.1 — 主流程</figcaption></figure>
```

`figures.json` 提供渲染任务：

```json
[
  {
    "target": "fig-main",
    "type": "flow",
    "data": { "layers": [], "edges": [] }
  }
]
```

`type` 支持 `sequence`、`flow` 和 `state`；`state` 复用分层流程渲染器。依赖图、组件图、类图或数据模型图超出组件库表达力时，按下文生成静态 SVG 并内联到正文。

## 文件树（代码地图用）

CSS 已在 `assets/components.css`，HTML 结构模式（目录可折叠、文件标角色 + 锚点）：

```html
<nav class="file-tree"><ul>
  <li><details class="dir" open><summary>src/</summary><ul>
    <li>utils.ts <span class="role">ref 解析与内容拉取</span> <a class="anchor" href="#sec-resolve">src/utils.ts:239</a></li>
  </ul></details></li>
</ul></nav>
```

## 超出组件库表达力时

复杂状态机、数据模型图、依赖网状图等组件库画不好的，在**生成时**优先使用已安装的本机工具渲染成静态 SVG 再内联：

- 本机装了 `d2`：质量最佳，`d2 input.d2 out.svg`
- 否则在生成时允许联网的前提下使用 `npx -y nomnoml input.noml out.svg`
- 工具拿不到、图形范围较小且手绘明显改善理解时，才回退为内联 SVG，并做视觉检查

渲染出来的 SVG 内联后把硬编码颜色替换为 token 变量，保持全局色板一致。
