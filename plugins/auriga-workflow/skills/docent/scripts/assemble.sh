#!/bin/sh
# docent 报告拼装：把固定资产与当次生成的片段拼成单文件离线 HTML。
# 用法: assemble.sh <body.html> <output.html> [custom.css] [title.txt] [lang] [figures.json]
#   body.html   — 无活动脚本的正文片段（含图容器）
#   output.html — 输出路径（建议 /tmp/docent-<主题slug>.html）
#   custom.css  — 当次定制版式 CSS（可选；传了路径但文件不存在会直接失败）
#   title.txt   — <title> 纯文本文件（可选，默认 Docent Report；内容会做 HTML 转义）
#   lang        — html lang 属性（可选，默认 zh）
#   figures.json — 图形目标、类型与数据（可选；由固定 bootstrap 渲染）
set -eu
umask 077

if [ "$#" -lt 2 ]; then
  echo "usage: assemble.sh <body.html> <output.html> [custom.css] [title.txt] [lang] [figures.json]" >&2
  exit 2
fi

BODY="$1"
OUT="$2"
CUSTOM="${3:-}"
TITLE_FILE="${4:-}"
LANG_ATTR="${5:-zh}"
FIGURES="${6:-}"

# 输出路径不得与任何输入相同：cat 正在被写入的文件会自馈循环、撑爆磁盘
for SRC in "$BODY" "$CUSTOM" "$TITLE_FILE" "$FIGURES"; do
  if [ -n "$SRC" ] && { [ "$SRC" = "$OUT" ] || { [ -e "$OUT" ] && [ "$SRC" -ef "$OUT" ]; }; }; then
    echo "assemble.sh: output path must differ from input: $OUT" >&2
    exit 2
  fi
done

if [ ! -f "$BODY" ]; then
  echo "assemble.sh: body fragment not found: $BODY" >&2
  exit 1
fi
if [ -n "$CUSTOM" ] && [ ! -f "$CUSTOM" ]; then
  echo "assemble.sh: custom css not found: $CUSTOM" >&2
  exit 1
fi
if [ -n "$TITLE_FILE" ] && [ ! -f "$TITLE_FILE" ]; then
  echo "assemble.sh: title file not found: $TITLE_FILE" >&2
  exit 1
fi
if [ -n "$FIGURES" ] && [ ! -f "$FIGURES" ]; then
  echo "assemble.sh: figures json not found: $FIGURES" >&2
  exit 1
fi

html_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}
if [ -n "$TITLE_FILE" ]; then
  TITLE="$(cat "$TITLE_FILE")"
else
  TITLE="Docent Report"
fi
TITLE_ESC="$(html_escape "$TITLE")"
LANG_ESC="$(html_escape "$LANG_ATTR")"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SD="$(cd "$SCRIPT_DIR/../assets" && pwd)"

# 先写临时文件，成功后再原子替换——失败不会留下残缺产物、也不会截断旧报告
TMP="$(mktemp "${TMPDIR:-/tmp}/docent-assemble.XXXXXX")"
SAFE_BODY="$(mktemp "${TMPDIR:-/tmp}/docent-body.XXXXXX")"
SAFE_CSS="$(mktemp "${TMPDIR:-/tmp}/docent-css.XXXXXX")"
SAFE_FIGURES="$(mktemp "${TMPDIR:-/tmp}/docent-figures.XXXXXX")"
trap 'rm -f "$TMP" "$SAFE_BODY" "$SAFE_CSS" "$SAFE_FIGURES"' EXIT

# 正文只承载结构和已转义文本；图形数据走独立 JSON。校验失败时拒绝打开报告，
# 避免仓库里的 HTML/脚本片段被误当成报告活动内容执行。
node "$SCRIPT_DIR/validate-inputs.mjs" \
  "$BODY" "$CUSTOM" "$FIGURES" "$SAFE_BODY" "$SAFE_CSS" "$SAFE_FIGURES"

NONCE="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
CSP="default-src 'none'; script-src 'nonce-$NONCE'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"

{
  printf '<!doctype html><html lang="%s"><head><meta charset="utf-8">' "$LANG_ESC"
  printf '<meta name="viewport" content="width=device-width, initial-scale=1">'
  printf '<meta http-equiv="Content-Security-Policy" content="%s">' "$CSP"
  printf '<title>%s</title>\n<style>\n' "$TITLE_ESC"
  cat "$SD/tokens.css" "$SD/components.css"
  if [ -s "$SAFE_CSS" ]; then
    cat "$SAFE_CSS"
  fi
  printf '</style>\n<script nonce="%s">\n' "$NONCE"
  cat "$SD/renderers.js"
  printf '</script></head>\n<body>\n'
  cat "$SAFE_BODY"
  printf '\n<script id="docent-figures" type="application/json" nonce="%s">' "$NONCE"
  cat "$SAFE_FIGURES"
  printf '</script>\n<script nonce="%s">\n' "$NONCE"
  cat "$SD/bootstrap.js"
  printf '</script>'
  printf '\n</body></html>\n'
} > "$TMP"

mv "$TMP" "$OUT"
trap - EXIT
rm -f "$SAFE_BODY" "$SAFE_CSS" "$SAFE_FIGURES"

printf 'assembled: %s\n' "$OUT"
