# 报告组件库

可复用的机械组件：design token、CSS 组件、数据驱动的 SVG 渲染器。生成报告时把需要的块**内联**进单文件 HTML（CSS 进 `<style>`，JS 进 `<script>`），然后用数据驱动它们——你负责内容和设计立场，组件负责对齐、箭头、缩进这些一次写对就不该重写的机械问题。

复用机制说明：这不是 React，但心智模型相同——渲染器是纯函数 `JSON 数据 → SVG 字符串`，页面里 `el.innerHTML = renderSequenceSvg(data)` 即可。写一张时序图只需要十几行数据，不要手画几百行 SVG 坐标。

**组件库不是模板**：版式、叙事结构、章节设计仍然每份报告定制；token 的具体取值也可以整体替换成暗色或其他立场（保持变量名不变，组件自动跟随）。

## Design token（推荐基准色板，与 session-compound 同源）

```css
:root {
  /* design token —— 暖纸面基调 */
  --canvas: #faf9f5;            /* 页面底色 */
  --surface-soft: #f5f0e8;      /* 浅层表面 */
  --card: #efe9de;              /* 卡片 / 图表节点 */
  --ink: #141413;               /* 标题主墨 */
  --body: #3d3d3a;              /* 正文 */
  --body-strong: #252523;       /* 正文强调 */
  --muted: #6c6a64;             /* 次要信息 */
  --hairline: #e6dfd8;          /* 分隔线 / 引导线 */
  --primary: #cc785c;           /* 珊瑚主色：锚点、关键路径 */
  --primary-active: #a9583e;
  --accent-teal: #5db8a6;       /* 青：辅助强调 / 正向 */
  --accent-amber: #e8a55a;      /* 琥珀：决策节点 / 注意 */
  --success: #5db872;
  --warning: #d4a017;
  --error: #c64545;
  --code-bg: #181715;           /* 代码块暗底 */
  --code-fg: #faf9f5;
}
```

## CSS 组件

```css
/* 文件树（代码地图用）：嵌套列表 + 引导线，禁止 ASCII 字符画 */
.file-tree ul { list-style: none; margin: 0; padding-left: 18px; border-left: 1px solid var(--hairline); }
.file-tree > ul { border-left: none; padding-left: 0; }
.file-tree li { position: relative; padding: 3px 0 3px 14px; }
.file-tree li::before { content: ""; position: absolute; left: 0; top: 14px; width: 10px; height: 1px; background: var(--hairline); }
.file-tree details.dir > summary { cursor: pointer; font-weight: 600; color: var(--ink); list-style: none; }
.file-tree details.dir > summary::before { content: "▸ "; color: var(--muted); }
.file-tree details.dir[open] > summary::before { content: "▾ "; }
.file-tree .role { color: var(--muted); font-size: 12px; margin-left: 8px; }

/* 锚点徽章：每个代码结论旁的 文件:行号 */
.anchor { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--surface-soft);
  border: 1px solid var(--hairline); border-radius: 6px; padding: 1px 7px;
  color: var(--primary-active); text-decoration: none; white-space: nowrap; }
.anchor:hover { border-color: var(--primary); }

/* 提示卡：坑 / 特例 / 正向结论 */
.callout { border-left: 3px solid var(--accent-teal); background: var(--surface-soft);
  padding: 10px 14px; border-radius: 0 8px 8px 0; margin: 14px 0; }
.callout.warn { border-left-color: var(--warning); }
.callout.danger { border-left-color: var(--error); }

/* 图表容器：统一留白与图注 */
.fig { margin: 22px 0; overflow-x: auto; }
.fig figcaption { color: var(--muted); font-size: 12.5px; margin-top: 6px; }
```

文件树用法（目录节点可折叠，文件节点标注角色 + 锚点）：

```html
<nav class="file-tree"><ul>
  <li><details class="dir" open><summary>src/</summary><ul>
    <li>utils.ts <span class="role">ref 解析与内容拉取</span> <a class="anchor" href="#sec-resolve">src/utils.ts:239</a></li>
    <li>workflow.ts <span class="role">模板写入</span></li>
  </ul></details></li>
</ul></nav>
```

## SVG 渲染器（数据驱动）

纯函数，无 DOM 依赖：输入 JSON，返回 `<svg>` 字符串。颜色全部走 token 变量（带兜底值），主题切换自动跟随。

```js
function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function textWidth(label) {
  let w = 0;
  for (const ch of String(label)) w += ch.charCodeAt(0) > 0x2e80 ? 14 : 7.5;
  return w;
}

/**
 * 时序图。data = {
 *   participants: [{ id, label, anchor? }],
 *   messages: [{ from, to, label, kind?: "return"|"sync", anchor? }],
 * }
 */
function renderSequenceSvg(data) {
  const ps = data.participants, msgs = data.messages;
  const headW = Math.max(150, ...ps.map((p) => textWidth(p.label) + 36));
  const colW = headW + 50, headH = 40, rowH = 48, padX = 24, padY = 14;
  const cx = (i) => padX + headW / 2 + i * colW;
  const width = padX * 2 + headW + colW * (ps.length - 1);
  const height = padY * 2 + headH + rowH * (msgs.length + 0.6);
  const idx = {};
  ps.forEach((p, i) => { idx[p.id] = i; });
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}"` +
    ` font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13">`;
  s += `<defs><marker id="dArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7"` +
    ` orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--body, #3d3d3a)"/></marker></defs>`;
  ps.forEach((p, i) => {
    s += `<line x1="${cx(i)}" y1="${padY + headH}" x2="${cx(i)}" y2="${height - padY}"` +
      ` stroke="var(--hairline, #e6dfd8)" stroke-dasharray="4 4"/>`;
  });
  ps.forEach((p, i) => {
    s += `<rect x="${cx(i) - headW / 2}" y="${padY}" width="${headW}" height="${headH - 8}" rx="8"` +
      ` fill="var(--card, #efe9de)" stroke="var(--hairline, #e6dfd8)"/>`;
    s += `<text x="${cx(i)}" y="${padY + 21}" text-anchor="middle" font-weight="600"` +
      ` fill="var(--ink, #141413)">${escapeXml(p.label)}`;
    if (p.anchor) s += `<title>${escapeXml(p.anchor)}</title>`;
    s += `</text>`;
  });
  msgs.forEach((m, k) => {
    const y = padY + headH + rowH * (k + 1) - 14;
    const label = escapeXml(m.label) + (m.anchor ? "  ·  " + escapeXml(m.anchor) : "");
    const stroke = ` stroke="var(--body, #3d3d3a)" marker-end="url(#dArr)"` +
      (m.kind === "return" ? ` stroke-dasharray="6 4"` : "");
    if (m.from === m.to) {
      const x = cx(idx[m.from]);
      s += `<path d="M ${x} ${y - 6} h 46 v 16 h -46" fill="none"${stroke}/>`;
      s += `<text x="${x + 54}" y="${y + 6}" fill="var(--body-strong, #252523)">${label}</text>`;
    } else {
      const x1 = cx(idx[m.from]), x2 = cx(idx[m.to]);
      s += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"${stroke}/>`;
      s += `<text x="${(x1 + x2) / 2}" y="${y - 7}" text-anchor="middle"` +
        ` fill="var(--body-strong, #252523)">${label}</text>`;
    }
  });
  return s + `</svg>`;
}

/**
 * 分层流程图（也可表达状态图：节点为状态、边为迁移）。data = {
 *   layers: [[{ id, label, anchor?, kind?: "decision"|"terminal" }]],  // 每层一行
 *   edges: [{ from, to, label? }],
 * }
 */
function renderFlowSvg(data) {
  const padX = 24, padY = 18, rowH = 84, nodeH = 44, gap = 30;
  const pos = {};
  const layerWidths = data.layers.map((layer) =>
    layer.reduce((acc, n) => acc + Math.max(96, textWidth(n.label) + 30), 0) + gap * (layer.length - 1));
  const width = Math.max(...layerWidths) + padX * 2;
  const height = padY * 2 + rowH * (data.layers.length - 1) + nodeH;
  let nodes = "";
  data.layers.forEach((layer, li) => {
    let x = (width - layerWidths[li]) / 2;
    const y = padY + li * rowH;
    for (const n of layer) {
      const w = Math.max(96, textWidth(n.label) + 30);
      pos[n.id] = { cx: x + w / 2, top: y, bottom: y + nodeH };
      const decision = n.kind === "decision";
      const rx = n.kind === "terminal" ? nodeH / 2 : decision ? 14 : 8;
      const stroke = decision ? "var(--accent-amber, #e8a55a)" : "var(--hairline, #e6dfd8)";
      nodes += `<rect x="${x}" y="${y}" width="${w}" height="${nodeH}" rx="${rx}"` +
        ` fill="var(--card, #efe9de)" stroke="${stroke}" stroke-width="${decision ? 1.6 : 1}"/>`;
      const mid = x + w / 2;
      if (n.anchor) {
        nodes += `<text x="${mid}" y="${y + 19}" text-anchor="middle" font-weight="600"` +
          ` fill="var(--ink, #141413)">${escapeXml(n.label)}</text>`;
        nodes += `<text x="${mid}" y="${y + 34}" text-anchor="middle" font-size="10"` +
          ` fill="var(--muted, #6c6a64)">${escapeXml(n.anchor)}</text>`;
      } else {
        nodes += `<text x="${mid}" y="${y + 27}" text-anchor="middle" font-weight="600"` +
          ` fill="var(--ink, #141413)">${escapeXml(n.label)}</text>`;
      }
      x += w + gap;
    }
  });
  let edges = "";
  for (const e of data.edges) {
    const a = pos[e.from], b = pos[e.to];
    edges += `<line x1="${a.cx}" y1="${a.bottom}" x2="${b.cx}" y2="${b.top - 2}"` +
      ` stroke="var(--body, #3d3d3a)" marker-end="url(#fArr)"/>`;
    if (e.label) {
      edges += `<text x="${(a.cx + b.cx) / 2 + 8}" y="${(a.bottom + b.top) / 2}"` +
        ` font-size="11" fill="var(--muted, #6c6a64)">${escapeXml(e.label)}</text>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}"` +
    ` font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13">` +
    `<defs><marker id="fArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7"` +
    ` orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--body, #3d3d3a)"/></marker></defs>` +
    edges + nodes + `</svg>`;
}
```

页面内用法：

```html
<figure class="fig" id="fig-main-flow">
  <div id="flow-root"></div>
  <figcaption>FIG.1 — ref 解析三段决策（src/utils.ts:239）</figcaption>
</figure>
<script>
  document.getElementById("flow-root").innerHTML = renderFlowSvg({
    layers: [
      [{ id: "in", label: "resolveContentRef()", anchor: "src/utils.ts:239" }],
      [{ id: "env", label: "AURIGA_CONTENT_REF 有值?", kind: "decision" }],
      [{ id: "tag", label: "v<version> tag" }, { id: "main", label: "main 兜底", kind: "terminal" }],
    ],
    edges: [
      { from: "in", to: "env" },
      { from: "env", to: "tag", label: "否" },
      { from: "env", to: "main", label: "无法读版本" },
    ],
  });
</script>
```

## 超出组件库表达力时

复杂状态机、ER 图、依赖网状图等组件库画不好的，在**生成时**用本机工具渲染成静态 SVG 再内联（生成时可以联网，"零网络请求"约束的是打开报告时）：

- 本机装了 `d2`：质量最佳，`d2 input.d2 out.svg`
- 否则 `npx -y nomnoml input.noml out.svg`（纯 Node 渲染，已验证可用）
- 工具拿不到时回退手绘 SVG（按 design-guidelines.md 的画法要点）

渲染出来的 SVG 内联后把硬编码颜色替换为 token 变量，保持全局色板一致。
