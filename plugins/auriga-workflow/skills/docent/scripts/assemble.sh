#!/bin/sh
# docent 报告拼装：把固定资产与当次生成的片段拼成单文件离线 HTML。
# 用法: assemble.sh <body.html> <output.html> [custom.css] [title] [lang]
#   body.html   — 正文片段（含图容器与内联调用脚本；渲染器已在 <head> 定义，可直接调用）
#   output.html — 输出路径（建议 /tmp/docent-<主题slug>.html）
#   custom.css  — 当次定制版式 CSS（可选）
#   title       — <title> 文本（可选，默认 Docent Report）
#   lang        — html lang 属性（可选，默认 zh）
set -eu

BODY="$1"
OUT="$2"
CUSTOM="${3:-}"
TITLE="${4:-Docent Report}"
LANG_ATTR="${5:-zh}"

SD="$(cd "$(dirname "$0")/../assets" && pwd)"

{
  printf '<!doctype html><html lang="%s"><head><meta charset="utf-8">' "$LANG_ATTR"
  printf '<meta name="viewport" content="width=device-width, initial-scale=1">'
  printf '<title>%s</title>\n<style>\n' "$TITLE"
  cat "$SD/tokens.css" "$SD/components.css"
  if [ -n "$CUSTOM" ] && [ -f "$CUSTOM" ]; then
    cat "$CUSTOM"
  fi
  printf '</style>\n<script>\n'
  cat "$SD/renderers.js"
  printf '</script></head>\n<body>\n'
  cat "$BODY"
  printf '\n</body></html>\n'
} > "$OUT"

printf 'assembled: %s\n' "$OUT"
