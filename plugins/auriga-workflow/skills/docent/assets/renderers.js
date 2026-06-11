function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function textWidth(label) {
  let w = 0;
  for (const ch of String(label)) w += ch.charCodeAt(0) > 0x2e80 ? 14 : 7.5;
  return w;
}

/* 文字 halo：画布底色描边，保证 label 压线、压图形时仍可读 */
const LABEL_HALO = ` paint-order="stroke" stroke="var(--canvas, #faf9f5)" stroke-width="4" stroke-linejoin="round"`;

/* 非法输入的可见降级：返回一张带错误说明的占位 SVG，绝不静默产出坏图 */
function svgEmpty(msg) {
  const w = textWidth(msg) + 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 32" width="${w}" font-size="12">` +
    `<text x="8" y="20" fill="var(--error, #c64545)">${escapeXml(msg)}</text></svg>`;
}

/* 被跳过的非法引用以可见警示行渲染在图底部，而不是静默丢弃或抛错炸掉整个 script 块 */
function svgWarnLine(skipped, y) {
  return `<text x="8" y="${y}" font-size="10" fill="var(--error, #c64545)">` +
    `⚠ 跳过 ${skipped.length} 条非法引用: ${escapeXml(skipped.join(", "))}</text>`;
}

/**
 * 时序图。data = {
 *   participants: [{ id, label, anchor? }],
 *   messages: [{ from, to, label, kind?: "return", anchor? }],   // from === to 画自环
 * }
 */
function renderSequenceSvg(data) {
  const ps = (data && data.participants) || [];
  const allMsgs = (data && data.messages) || [];
  if (!ps.length) return svgEmpty("docent renderSequenceSvg: participants 为空");
  const idx = {};
  ps.forEach((p, i) => { idx[p.id] = i; });
  const skipped = [];
  const msgs = allMsgs.filter((m) => {
    if (idx[m.from] === undefined || idx[m.to] === undefined) {
      skipped.push(`${m.from}→${m.to}`);
      return false;
    }
    return true;
  });
  const headW = Math.max(150, ...ps.map((p) => textWidth(p.label) + 36));
  const colW = headW + 50, headH = 40, rowH = 48, padX = 24, padY = 14;
  const cx = (i) => padX + headW / 2 + i * colW;
  const width = padX * 2 + headW + colW * (ps.length - 1);
  const height = padY * 2 + headH + rowH * (msgs.length + 0.6) + (skipped.length ? 18 : 0);
  // 消息 label 的横向延展决定 viewBox，超长 label 不裁剪
  let minX = 0, maxX = width;
  let s = "";
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
      ` fill="var(--ink, #141413)">` +
      (p.anchor ? `<title>${escapeXml(p.anchor)}</title>` : "") +
      `${escapeXml(p.label)}</text>`;
  });
  msgs.forEach((m, k) => {
    const y = padY + headH + rowH * (k + 1) - 14;
    const rawLabel = String(m.label) + (m.anchor ? "  ·  " + m.anchor : "");
    const label = escapeXml(m.label) + (m.anchor ? "  ·  " + escapeXml(m.anchor) : "");
    const stroke = ` stroke="var(--body, #3d3d3a)" marker-end="url(#dArr)"` +
      (m.kind === "return" ? ` stroke-dasharray="6 4"` : "");
    if (m.from === m.to) {
      const x = cx(idx[m.from]);
      s += `<path d="M ${x} ${y - 6} h 46 v 16 h -46" fill="none"${stroke}/>`;
      s += `<text x="${x + 54}" y="${y + 6}"${LABEL_HALO} fill="var(--body-strong, #252523)">${label}</text>`;
      maxX = Math.max(maxX, x + 54 + textWidth(rawLabel) + 8);
    } else {
      const x1 = cx(idx[m.from]), x2 = cx(idx[m.to]);
      s += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"${stroke}/>`;
      s += `<text x="${(x1 + x2) / 2}" y="${y - 7}" text-anchor="middle"${LABEL_HALO}` +
        ` fill="var(--body-strong, #252523)">${label}</text>`;
      const half = textWidth(rawLabel) / 2 + 6;
      minX = Math.min(minX, (x1 + x2) / 2 - half);
      maxX = Math.max(maxX, (x1 + x2) / 2 + half);
    }
  });
  if (skipped.length) s += svgWarnLine(skipped, height - 6);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} 0 ${maxX - minX} ${height}"` +
    ` width="${maxX - minX}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13">` +
    s + `</svg>`;
}

/**
 * 分层流程图（也可表达状态图：节点为状态、边为迁移）。data = {
 *   layers: [[{ id, label, anchor?, kind?: "decision" | "terminal" }]],  // 每层一行
 *   edges: [{ from, to, label? }],
 * }
 * 渲染保证：同位 label 围绕中点竖向错峰；viewBox 按最长 label 自动加宽（不裁剪）；
 * 跨层与回跳的边走右侧正交导轨（rail），label 锚定在导轨右侧空白区，结构上不会压到节点；
 * 非法输入可见降级（占位图 / 底部警示行），不抛错炸掉同一 script 块里的其他图。
 */
function renderFlowSvg(data) {
  const layers = (data && data.layers) || [];
  if (!layers.length || layers.every((l) => !l || !l.length)) {
    return svgEmpty("docent renderFlowSvg: layers 为空");
  }
  const padX = 24, padY = 18, rowH = 84, nodeH = 44, gap = 30;
  // 节点宽度同时容纳 label（13px 字号）与 anchor 第二行（10px 字号，约 0.8 倍宽）
  const nodeW = (n) =>
    Math.max(96, textWidth(n.label) + 30, n.anchor ? textWidth(n.anchor) * 0.8 + 30 : 0);
  const pos = {};
  const layerWidths = layers.map((layer) =>
    layer.reduce((acc, n) => acc + nodeW(n), 0) + gap * (layer.length - 1));
  const width = Math.max(...layerWidths) + padX * 2;
  const skipped = [];
  const edgesIn = (data && data.edges) || [];
  let nodes = "";
  layers.forEach((layer, li) => {
    let x = (width - layerWidths[li]) / 2;
    const y = padY + li * rowH;
    for (const n of layer) {
      const w = nodeW(n);
      pos[n.id] = { cx: x + w / 2, cy: y + nodeH / 2, top: y, bottom: y + nodeH, right: x + w, layer: li };
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
  let labelEls = "";
  let minX = 0, maxX = width;
  const buckets = {};
  const maxNodeRight = Math.max(...Object.values(pos).map((p) => p.right));
  const railEdges = [];
  for (const e of edgesIn) {
    const a = pos[e.from], b = pos[e.to];
    if (!a || !b) {
      skipped.push(`${e.from}→${e.to}`);
      continue;
    }
    if (b.layer - a.layer === 1) {
      // 相邻下行：直线，label 进同位桶（绘制前统一错峰）
      edges += `<line x1="${a.cx}" y1="${a.bottom}" x2="${b.cx}" y2="${b.top - 2}"` +
        ` stroke="var(--body, #3d3d3a)" marker-end="url(#fArr)"/>`;
      if (e.label) {
        const midX = (a.cx + b.cx) / 2, midY = (a.bottom + b.top) / 2;
        const key = Math.round(midX / 60) + ":" + Math.round(midY / 40);
        (buckets[key] = buckets[key] || []).push({ x: midX, midY, text: e.label });
      }
    } else {
      railEdges.push(e);
    }
  }
  // 跨层 / 回跳 / 同层：右侧正交导轨。lane 按跨度从小到大向外排（短边贴内侧），
  // 每条 lane 预留自身 label 的横向带宽——不同 lane 的导轨与文字互不交叠。
  railEdges.sort((p, q) =>
    Math.abs(pos[p.to].layer - pos[p.from].layer) - Math.abs(pos[q.to].layer - pos[q.from].layer));
  let railCursor = maxNodeRight + 36;
  for (const e of railEdges) {
    const a = pos[e.from], b = pos[e.to];
    const railX = railCursor;
    railCursor += 26 + (e.label ? textWidth(e.label) + 14 : 0);
    edges += `<circle cx="${a.right}" cy="${a.cy}" r="2.5" fill="var(--body, #3d3d3a)"/>`;
    edges += `<path d="M ${a.right} ${a.cy} H ${railX} V ${b.cy} H ${b.right + 2}" fill="none"` +
      ` stroke="var(--body, #3d3d3a)" marker-end="url(#fArr)"/>`;
    if (e.label) {
      labelEls += `<text class="edge-label" text-anchor="start" x="${railX + 8}" y="${(a.cy + b.cy) / 2 + 4}"` +
        ` font-size="11"${LABEL_HALO} fill="var(--muted, #6c6a64)">${escapeXml(e.label)}</text>`;
    }
    maxX = Math.max(maxX, railCursor - 12);
  }
  for (const key in buckets) {
    const arr = buckets[key];
    arr.forEach((l, i) => {
      const y = l.midY + 4 + (i - (arr.length - 1) / 2) * 15;
      const half = textWidth(l.text) / 2 + 6;
      minX = Math.min(minX, l.x - half);
      maxX = Math.max(maxX, l.x + half);
      labelEls += `<text class="edge-label" x="${l.x}" y="${y}" text-anchor="middle" font-size="11"` +
        `${LABEL_HALO} fill="var(--muted, #6c6a64)">${escapeXml(l.text)}</text>`;
    });
  }
  const height = padY * 2 + rowH * (layers.length - 1) + nodeH + (skipped.length ? 18 : 0);
  const warn = skipped.length ? svgWarnLine(skipped, height - 6) : "";
  const vbW = maxX - minX;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} 0 ${vbW} ${height}" width="${vbW}"` +
    ` font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13">` +
    `<defs><marker id="fArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7"` +
    ` orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--body, #3d3d3a)"/></marker></defs>` +
    edges + nodes + labelEls + warn + `</svg>`;
}

/* 显式公开渲染器接口：内联进报告时供正文脚本调用，也让静态分析认得公共面 */
if (typeof globalThis !== "undefined") {
  globalThis.renderSequenceSvg = renderSequenceSvg;
  globalThis.renderFlowSvg = renderFlowSvg;
}
