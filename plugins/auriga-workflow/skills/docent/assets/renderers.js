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
