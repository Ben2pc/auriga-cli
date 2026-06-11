# 报告组件库：资产清单与拼装配方

固定资产放在 `<skill-dir>/assets/` 下，**按名取用、命令拼装**——不要通过模型逐字重打这些内容（那是几千 token 的复印机工作）。你只生成三样东西：正文内容、图的 JSON 数据、当次定制的版式 CSS。

**组件库不是模板**：版式、叙事结构、章节设计仍然每份报告定制；token 取值可以整体替换成暗色或其他立场（变量名不变，组件自动跟随）。

## 资产清单（命名获取）

| 资产 | 内容 | 拼进哪里 |
|---|---|---|
| `assets/tokens.css` | design token 基准色板（暖纸面 + 炭墨 + 珊瑚主色 + 青/琥珀强调，与 session-compound 同源） | `<style>` 开头 |
| `assets/components.css` | 文件树 `file-tree`、锚点徽章 `anchor`、提示卡 `callout`（`.warn`/`.danger`）、图表容器 `fig` | `<style>` |
| `assets/renderers.js` | 纯函数 SVG 渲染器：`renderSequenceSvg`（时序图）、`renderFlowSvg`（分层流程图/状态图），含 `escapeXml`、中英文宽度估算 | `<script>` 开头 |

## 拼装：scripts/assemble.sh

先用文件编辑工具写出两个片段：`body 片段`（正文 + 图容器 + 内联调用脚本）和 `custom.css`（当次定制版式，可选），然后执行拼装脚本：

```sh
sh <skill-dir>/scripts/assemble.sh /tmp/docent-body.html /tmp/docent-<主题slug>.html /tmp/docent-custom.css "<报告标题>"
```

脚本会把 `assets/` 三件资产注入完整文档：token 与组件 CSS 进 `<style>`，`renderers.js` 定义在 `<head>`——所以正文里任何位置的内联 `<script>` 都可以直接调用渲染器（目标 `<div>` 在调用之前出现即可）。不要自己手拼文档骨架，更不要重打资产内容。

## 渲染器数据契约

```text
renderSequenceSvg({
  participants: [{ id, label, anchor? }],
  messages: [{ from, to, label, kind?: "return", anchor? }],   // from === to 画自环
})

renderFlowSvg({
  layers: [[{ id, label, anchor?, kind?: "decision" | "terminal" }]],  // 每层一行，自动横向居中
  edges: [{ from, to, label? }],
})
```

页面内用法：

```html
<figure class="fig"><div id="fig-main"></div><figcaption>FIG.1 — 主流程</figcaption></figure>
<!-- 尾部、renderers.js 之后 -->
<script>
  document.getElementById("fig-main").innerHTML = renderFlowSvg({ layers: [...], edges: [...] });
</script>
```

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

复杂状态机、ER 图、依赖网状图等组件库画不好的，在**生成时**用本机工具渲染成静态 SVG 再内联（生成时可以联网，"零网络请求"约束的是打开报告时）：

- 本机装了 `d2`：质量最佳，`d2 input.d2 out.svg`
- 否则 `npx -y nomnoml input.noml out.svg`（纯 Node 渲染，已验证可用）
- 工具拿不到时回退手绘 SVG（按 design-guidelines.md 的画法要点）

渲染出来的 SVG 内联后把硬编码颜色替换为 token 变量，保持全局色板一致。
