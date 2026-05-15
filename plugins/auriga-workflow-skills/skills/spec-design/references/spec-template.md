# spec.md 模板 (spec.md template)

Copy this template into `docs/specs/<topic>/spec.md` and replace each `<placeholder>`. Pairs with `validation-contract-template.md` (and `umbrella-template.md` when decomposition triggers).
将本模板复制到 `docs/specs/<topic>/spec.md` 并填充每个 `<占位>`。与 `validation-contract-template.md` 配套使用 (拆分时还配套 `umbrella-template.md`)。

**Language rule / 语言规则**: section headers below are bilingual (English anchor + 中文 hint) and must be kept verbatim — tooling and reviewers grep on the English anchors. **Body content (the prose under each header) must be written in the user's conversation language.** If the conversation is in Chinese, write the Why / Findings / What sections in Chinese; if English, in English. Do not mix.

Do not strip optional sections (`References`, `Findings` when sparse) — leave a one-line "none / 无" if genuinely absent so future readers don't wonder whether the section was simply forgotten.

```markdown
# <feature> — Spec (<功能> — 规范)

> One-sentence elevator pitch (optional but recommended) / 一句话概括这个 spec 在做什么 (可选但推荐).

## Why (为什么做)
<1–4 paragraphs: motivation, pain we're addressing, the inspiration / prior art if any.>
<1–4 段：动机、要解决的痛点、灵感 / 已有方案 (如有)。>

## Findings (调研发现)
<Bulleted past-facing observations from A1 research. Each bullet anchors to a specific source: file path, commit, doc, external URL.>
<A1 调研阶段已经发现的事实，列表呈现 (描述"当前是什么样"，不写"将来要怎么做")。每条都锚定到具体来源：文件路径、commit、文档、外链。>

## What (做什么)
<The external behavior contract. May be multiple subsections (### 1. …, ### 2. …) when the surface is broader than one cohesive concept. Stay above the implementation line.>
<外部行为契约。当涉及面较广时可拆多个子节 (### 1. …, ### 2. …)。停在实现线之上，不要写"用哪个文件 / 哪个函数 / 哪个库"。>

## Out of scope (本次不做)
<Explicit "this spec is not doing X / Y" list, with brief reason where useful.>
<显式列出"本 spec 不做 X / Y"，必要时附简短理由。>

## Open questions (悬而未决)
<What this spec leaves for plan / impl phase to resolve. Numbered list.>
<本 spec 留给 plan / 实现阶段决定的问题。编号列表。>

## References (参考资料 — optional / 可选；required when any URL was supplied during clarification / 澄清期间用户给过任何外链时必填)
<Bulleted external links + when they were supplied + their relevance to the design.>
<外链列表 + 来源时机 + 对设计的影响要点。>
```
