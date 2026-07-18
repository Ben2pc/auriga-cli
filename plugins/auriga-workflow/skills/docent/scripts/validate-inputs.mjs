#!/usr/bin/env node

import fs from "node:fs";

const [
  bodyPath,
  customCssPath,
  figuresPath,
  safeBodyPath,
  safeCssPath,
  safeFiguresPath,
] = process.argv.slice(2);

if (!bodyPath || !safeBodyPath || !safeCssPath || !safeFiguresPath) {
  console.error(
    "usage: validate-inputs.mjs <body.html> <custom.css|''> <figures.json|''> <safe-body.html> <safe-css.css> <safe-figures.json>",
  );
  process.exit(2);
}

function reject(text, rules, label) {
  for (const [pattern, reason] of rules) {
    if (pattern.test(text)) {
      throw new Error(`${label} 包含不允许的活动内容: ${reason}`);
    }
  }
}

function decodeHtmlEntities(value) {
  const named = new Map([
    ["amp", "&"],
    ["colon", ":"],
    ["newline", "\n"],
    ["tab", "\t"],
  ]);
  return value.replace(/&(?:#(x[0-9a-f]+|[0-9]+)|([a-z]+));?/gi, (whole, numeric, name) => {
    if (numeric) {
      const radix = numeric[0].toLowerCase() === "x" ? 16 : 10;
      const digits = radix === 16 ? numeric.slice(1) : numeric;
      const codePoint = Number.parseInt(digits, radix);
      if (Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
        return String.fromCodePoint(codePoint);
      }
      return whole;
    }
    return named.get(String(name).toLowerCase()) ?? whole;
  });
}

function scanTags(html) {
  const tags = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start < 0) break;
    if (html.startsWith("<!--", start)) {
      const end = html.indexOf("-->", start + 4);
      if (end < 0) throw new Error("body fragment 包含未闭合的 HTML 注释");
      cursor = end + 3;
      continue;
    }

    let quote = "";
    let end = start + 1;
    for (; end < html.length; end += 1) {
      const char = html[end];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      }
    }
    if (end >= html.length) throw new Error("body fragment 包含未闭合的 HTML 标签");
    tags.push(html.slice(start + 1, end));
    cursor = end + 1;
  }
  return tags;
}

function parseAttributes(source) {
  const attributes = [];
  let cursor = 0;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] || "")) cursor += 1;
    if (cursor >= source.length || source[cursor] === "/") break;

    const nameMatch = /^[^\s=/>]+/.exec(source.slice(cursor));
    if (!nameMatch) throw new Error(`body fragment 包含无法解析的属性: ${source.slice(cursor)}`);
    const name = nameMatch[0];
    cursor += name.length;
    while (/\s/.test(source[cursor] || "")) cursor += 1;

    let value = null;
    if (source[cursor] === "=") {
      cursor += 1;
      while (/\s/.test(source[cursor] || "")) cursor += 1;
      const quote = source[cursor];
      if (quote === '"' || quote === "'") {
        cursor += 1;
        const end = source.indexOf(quote, cursor);
        if (end < 0) throw new Error(`body fragment 属性 ${name} 缺少结束引号`);
        value = source.slice(cursor, end);
        cursor = end + 1;
      } else {
        const valueMatch = /^[^\s>]+/.exec(source.slice(cursor));
        if (!valueMatch) throw new Error(`body fragment 属性 ${name} 缺少值`);
        value = valueMatch[0];
        cursor += value.length;
      }
    }
    attributes.push({ name, value });
  }
  return attributes;
}

function validateBody(html) {
  const forbiddenTags = new Set([
    "script",
    "iframe",
    "object",
    "embed",
    "form",
    "base",
    "meta",
    "link",
    "style",
    "body",
    "head",
    "html",
  ]);
  const ids = new Set();

  for (const rawTag of scanTags(html)) {
    const trimmed = rawTag.trim();
    if (!trimmed || trimmed.startsWith("!") || trimmed.startsWith("?")) {
      throw new Error(`body fragment 包含不允许的标签边界: <${trimmed}>`);
    }
    const closing = trimmed.startsWith("/");
    const match = /^\/?\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(trimmed);
    if (!match) throw new Error(`body fragment 包含无法解析的标签: <${trimmed}>`);
    const tagName = match[1].toLowerCase();
    if (forbiddenTags.has(tagName)) {
      throw new Error(`body fragment 包含不允许的活动内容: ${tagName} 标签`);
    }
    if (closing) continue;

    const attributes = parseAttributes(trimmed.slice(match[0].length));
    for (const attribute of attributes) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (/^on[a-z]/i.test(name)) {
        throw new Error(`body fragment 包含不允许的活动内容: 事件处理属性 ${attribute.name}`);
      }
      if (name === "srcdoc") {
        throw new Error("body fragment 包含不允许的活动内容: srcdoc 属性");
      }
      if (name === "id" && value) {
        if (ids.has(value)) throw new Error(`body fragment 包含重复的 HTML id: ${value}`);
        ids.add(value);
      }
      if (["href", "xlink:href", "src"].includes(name)) {
        if (value === null) throw new Error(`body fragment 属性 ${attribute.name} 缺少值`);
        const decoded = decodeHtmlEntities(value).trim().replace(/[\u0000-\u0020]+/g, "");
        const allowed = name === "src" ? /^data:/i.test(decoded) : /^#[A-Za-z][A-Za-z0-9_.:-]*$/.test(decoded);
        if (!allowed) {
          throw new Error(`body fragment 包含不允许的外部或脚本 URL: ${attribute.name}`);
        }
      }
      if (name === "style" && value) {
        validateCss(decodeHtmlEntities(value), "style 属性", false);
      }
    }
  }
  return ids;
}

function validateCss(css, label, rejectStyleEnd = true) {
  const rules = [[/@import\b/i, "CSS import"]];
  if (rejectStyleEnd) rules.unshift([/<\/\s*style\b/i, "style 结束标签"]);
  reject(css, rules, label);

  const urlPattern = /url\s*\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/gi;
  let match;
  let matched = 0;
  while ((match = urlPattern.exec(css)) !== null) {
    matched += 1;
    const decoded = decodeHtmlEntities(match[2] ?? match[3] ?? "")
      .trim()
      .replace(/[\u0000-\u0020]+/g, "");
    if (!/^#[A-Za-z][A-Za-z0-9_.:-]*$/.test(decoded) && !/^data:/i.test(decoded)) {
      throw new Error(`${label} 包含不允许的活动内容: 外部 URL`);
    }
  }
  const starts = css.match(/url\s*\(/gi)?.length ?? 0;
  if (matched !== starts) throw new Error(`${label} 包含无法解析的 url()`);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} 必须是非空字符串`);
}

function validateLocalHref(value, label) {
  if (value === undefined) return;
  if (typeof value !== "string" || !/^#[A-Za-z][A-Za-z0-9_.:-]*$/.test(value)) {
    throw new Error(`${label} 必须是报告内部锚点`);
  }
}

function validateNode(node, label) {
  requireObject(node, label);
  requireString(node.id, `${label}.id`);
  requireString(node.label, `${label}.label`);
  if (node.anchor !== undefined && typeof node.anchor !== "string") {
    throw new Error(`${label}.anchor 必须是字符串`);
  }
  validateLocalHref(node.href, `${label}.href`);
}

function validateSequence(data, target) {
  if (!Array.isArray(data.participants) || !Array.isArray(data.messages)) {
    throw new Error(`sequence ${target} 必须包含 participants 与 messages 数组`);
  }
  const ids = new Set();
  data.participants.forEach((participant, index) => {
    validateNode(participant, `sequence ${target}.participants[${index}]`);
    if (ids.has(participant.id)) throw new Error(`sequence ${target} 包含重复参与者 id: ${participant.id}`);
    ids.add(participant.id);
  });
  data.messages.forEach((message, index) => {
    const label = `sequence ${target}.messages[${index}]`;
    requireObject(message, label);
    requireString(message.from, `${label}.from`);
    requireString(message.to, `${label}.to`);
    requireString(message.label, `${label}.label`);
    if (!ids.has(message.from) || !ids.has(message.to)) {
      throw new Error(`${label} 引用了不存在的参与者`);
    }
    if (message.kind !== undefined && message.kind !== "return") {
      throw new Error(`${label}.kind 只支持 return`);
    }
    validateLocalHref(message.href, `${label}.href`);
  });
}

function validateFlow(data, target) {
  if (!Array.isArray(data.layers) || !data.layers.every(Array.isArray) || !Array.isArray(data.edges)) {
    throw new Error(`flow/state ${target} 必须包含二维 layers 数组与 edges 数组`);
  }
  const ids = new Set();
  data.layers.forEach((layer, layerIndex) => {
    layer.forEach((node, nodeIndex) => {
      const label = `flow/state ${target}.layers[${layerIndex}][${nodeIndex}]`;
      validateNode(node, label);
      if (ids.has(node.id)) throw new Error(`flow/state ${target} 包含重复节点 id: ${node.id}`);
      ids.add(node.id);
      if (node.kind !== undefined && !new Set(["decision", "terminal"]).has(node.kind)) {
        throw new Error(`${label}.kind 不受支持`);
      }
    });
  });
  data.edges.forEach((edge, index) => {
    const label = `flow/state ${target}.edges[${index}]`;
    requireObject(edge, label);
    requireString(edge.from, `${label}.from`);
    requireString(edge.to, `${label}.to`);
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new Error(`${label} 引用了不存在的节点`);
    }
    if (edge.label !== undefined && typeof edge.label !== "string") {
      throw new Error(`${label}.label 必须是字符串`);
    }
  });
}

const body = fs.readFileSync(bodyPath, "utf8");
const bodyIds = validateBody(body);

let css = "";
if (customCssPath) {
  css = fs.readFileSync(customCssPath, "utf8");
  validateCss(css, "custom CSS");
}

let figures = [];
if (figuresPath) {
  figures = JSON.parse(fs.readFileSync(figuresPath, "utf8"));
  if (!Array.isArray(figures)) throw new Error("figures.json 顶层必须是数组");

  for (const figure of figures) {
    requireObject(figure, "figure");
    if (!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(String(figure.target || ""))) {
      throw new Error(`figure target 不是安全的 HTML id: ${String(figure.target)}`);
    }
    if (!bodyIds.has(figure.target)) {
      throw new Error(`figure target 在正文中不存在: ${figure.target}`);
    }
    if (!new Set(["sequence", "flow", "state"]).has(figure.type)) {
      throw new Error(`不支持的 figure type: ${String(figure.type)}`);
    }
    requireObject(figure.data, `figure ${figure.target}.data`);
    if (figure.type === "sequence") validateSequence(figure.data, figure.target);
    else validateFlow(figure.data, figure.target);
  }
}

const safeJson = JSON.stringify(figures)
  .replace(/&/g, "\\u0026")
  .replace(/</g, "\\u003c")
  .replace(/>/g, "\\u003e")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

fs.writeFileSync(safeBodyPath, body);
fs.writeFileSync(safeCssPath, css);
fs.writeFileSync(safeFiguresPath, safeJson);
