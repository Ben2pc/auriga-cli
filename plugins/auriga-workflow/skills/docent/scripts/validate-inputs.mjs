#!/usr/bin/env node

import fs from "node:fs";

const [bodyPath, customCssPath, figuresPath, safeFiguresPath] = process.argv.slice(2);

if (!bodyPath || !safeFiguresPath) {
  console.error("usage: validate-inputs.mjs <body.html> <custom.css|''> <figures.json|''> <safe-figures.json>");
  process.exit(2);
}

function reject(text, rules, label) {
  for (const [pattern, reason] of rules) {
    if (pattern.test(text)) {
      throw new Error(`${label} 包含不允许的活动内容: ${reason}`);
    }
  }
}

const body = fs.readFileSync(bodyPath, "utf8");
reject(
  body,
  [
    [/<\s*script\b/i, "script 标签"],
    [/<\s*(?:iframe|object|embed|form|base|meta|link|style)\b/i, "可执行或可导航标签"],
    [/<\/\s*(?:body|head|html)\b/i, "文档边界标签"],
    [/\bon[a-z]+\s*=/i, "事件处理属性"],
    [/\bsrcdoc\s*=/i, "srcdoc 属性"],
    [/(?:href|src|xlink:href)\s*=\s*["']?\s*(?:javascript:|https?:|\/\/)/i, "外部或脚本 URL"],
  ],
  "body fragment",
);

if (customCssPath) {
  const css = fs.readFileSync(customCssPath, "utf8");
  reject(
    css,
    [
      [/<\/\s*style\b/i, "style 结束标签"],
      [/@import\b/i, "CSS import"],
      [/url\s*\(\s*["']?\s*(?:javascript:|https?:|\/\/)/i, "外部或脚本 URL"],
    ],
    "custom CSS",
  );
}

let figures = [];
if (figuresPath) {
  figures = JSON.parse(fs.readFileSync(figuresPath, "utf8"));
  if (!Array.isArray(figures)) throw new Error("figures.json 顶层必须是数组");

  for (const figure of figures) {
    if (!figure || typeof figure !== "object") throw new Error("figure 必须是对象");
    if (!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(String(figure.target || ""))) {
      throw new Error(`figure target 不是安全的 HTML id: ${String(figure.target)}`);
    }
    if (!new Set(["sequence", "flow", "state"]).has(figure.type)) {
      throw new Error(`不支持的 figure type: ${String(figure.type)}`);
    }
    if (!figure.data || typeof figure.data !== "object" || Array.isArray(figure.data)) {
      throw new Error(`figure data 必须是对象: ${String(figure.target)}`);
    }
  }
}

const safeJson = JSON.stringify(figures)
  .replace(/&/g, "\\u0026")
  .replace(/</g, "\\u003c")
  .replace(/>/g, "\\u003e")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");
fs.writeFileSync(safeFiguresPath, safeJson);
