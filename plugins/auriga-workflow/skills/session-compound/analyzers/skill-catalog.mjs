#!/usr/bin/env node
/**
 * Shared substrate helpers for the session-compound analyzers.
 *
 * Both claude-code.mjs and codex.mjs ship inside the SAME plugin artifact
 * (auriga-workflow), so a relative import of this file is safe — it is NOT a
 * cross-distribution-boundary reference. The analyzers run as standalone
 * `node <path>.mjs` with no node_modules on the path, so everything here is
 * zero-dependency (node: stdlib only) — no gray-matter, no TS imports.
 *
 * Provides the "evaluation substrate" the analyzers emit under health.*:
 *   - skill_catalog  — installed skills available to the session
 *   - workflow_rules — auriga managed-block rules from the repo AGENTS.md
 *   - compliance     — mechanically-decidable workflow predicates
 *
 * The semantic judgement (recall gaps, per-skill eval) is NOT here — that is
 * dispatched to an independent subagent by SKILL.md. This file only assembles
 * the deterministic inputs.
 */

import fs from 'node:fs'
import path from 'node:path'

// ---------- skill catalog ----------

// Recursively collect SKILL.md paths under the given roots, deduped by
// realpath (so a symlinked / multiply-rooted skill is found once). Mirrors the
// shape of skill-cleaner's walkFiles (skill-cleaner.ts:149-186): skip
// node_modules/.git, follow symlinks but guard against cycles via a realpath
// seen-set, bounded depth.
export function walkSkillRoots(roots, maxDepth = 10) {
  const out = []
  const seenDirs = new Set()
  const seenFiles = new Set()
  function walk(dir, depth) {
    if (depth > maxDepth) return
    let real
    try {
      real = fs.realpathSync(dir)
    } catch {
      return
    }
    if (seenDirs.has(real)) return
    seenDirs.add(real)
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        let stat
        try {
          stat = fs.statSync(full)
        } catch {
          continue
        }
        if (stat.isDirectory()) walk(full, depth + 1)
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        let realFile
        try {
          realFile = fs.realpathSync(full)
        } catch {
          realFile = full
        }
        if (seenFiles.has(realFile)) continue
        seenFiles.add(realFile)
        out.push({ path: full, realPath: realFile })
      }
    }
  }
  for (const root of roots) {
    if (root && fs.existsSync(root)) walk(root, 0)
  }
  return out
}

function sanitizeLine(value) {
  return String(value).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function unquote(raw) {
  const v = raw.trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1)
  }
  return v
}

// Minimal SKILL.md frontmatter parse — name + description only. Supports plain
// scalars and `|` / `>` block scalars. Mirrors skill-cleaner.ts:188-240; kept
// dependency-free on purpose (analyzers have no node_modules).
export function parseFrontmatter(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return { name: undefined, description: undefined }
  }
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { name: undefined, description: undefined }
  const fm = []
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') break
    fm.push(lines[i] ?? '')
  }
  let name
  let description
  for (let i = 0; i < fm.length; i++) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(fm[i] ?? '')
    if (!m) continue
    const key = m[1]
    const raw = m[2] ?? ''
    if (key === 'name') name = sanitizeLine(unquote(raw))
    if (key === 'description') {
      if (raw.trim() === '|' || raw.trim() === '>') {
        const block = []
        for (let j = i + 1; j < fm.length; j++) {
          if (/^[A-Za-z0-9_-]+:\s*/.test(fm[j] ?? '')) break
          block.push((fm[j] ?? '').replace(/^\s{2}/, ''))
        }
        description = sanitizeLine(block.join(' '))
      } else {
        description = sanitizeLine(unquote(raw))
      }
    }
  }
  return { name, description }
}

// Build the catalog of installed skills available to the session.
//   roots    — directories to scan for SKILL.md (CLI-specific; caller passes
//              its default roots or --skill-root overrides).
//   repoCwd  — the session's cwd; an entry is `editable` when its source lives
//              inside this repo (so SKILL.md can be optimized in-place). A
//              cache copy is not editable, but if a same-named skill source
//              also exists in-repo the deduped entry is marked editable.
// Deduped by skill name (collapses the many cached plugin versions into one
// "available skill" — name dedup is intentionally lossy on version; see
// SKILL.md note). realpath dedup in walkSkillRoots handles symlink duplicates.
export function buildSkillCatalog(roots, repoCwd) {
  const repoPrefix = repoCwd ? path.resolve(repoCwd) + path.sep : null
  const byName = new Map()
  for (const { realPath } of walkSkillRoots(roots)) {
    const { name, description } = parseFrontmatter(realPath)
    if (!name) continue
    const editable = repoPrefix ? path.resolve(realPath).startsWith(repoPrefix) : false
    const existing = byName.get(name)
    if (existing) {
      // Same skill name across roots (cache version + in-repo source, etc.):
      // keep one entry; editable is true if ANY copy is in-repo.
      existing.editable = existing.editable || editable
      if (!existing.description && description) existing.description = description
    } else {
      byName.set(name, { name, description: description || '', editable })
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ---------- workflow rules (managed block) ----------

// Mirrors the frozen v1 marker contract from src/workflow-markers.ts:51-53.
// Re-inlined here (not imported) because that file is TypeScript shipped in the
// CLI artifact, a different distribution boundary than this plugin. The marker
// schema is frozen (`v1`), so duplicating the regex is the intended pattern.
const START_LINE_RE = /^<!--\s*AURIGA:WORKFLOW:v1\s+START\b.*?-->[ \t]*$/m
const END_LINE_RE = /^<!--\s*AURIGA:WORKFLOW:v1\s+END(?:\s+sha256=([0-9a-f]+))?[ \t]*-->[ \t]*$/m

// Parse the auriga managed-block workflow rules from the repo's AGENTS.md
// (fallback CLAUDE.md) at `cwd`. Returns [{n, text}] (one per top-level
// numbered item, multi-line items joined); [] when no readable file or no
// managed block — never throws.
export function parseWorkflowRules(cwd) {
  if (!cwd) return []
  const candidates = [path.join(cwd, 'AGENTS.md'), path.join(cwd, 'CLAUDE.md')]
  let content = null
  for (const f of candidates) {
    try {
      content = fs.readFileSync(f, 'utf8')
      break
    } catch {
      // try next
    }
  }
  if (content == null) return []
  const start = START_LINE_RE.exec(content)
  if (!start) return []
  const afterStart = start.index + start[0].length
  const endRel = END_LINE_RE.exec(content.slice(afterStart))
  const block = endRel ? content.slice(afterStart, afterStart + endRel.index) : content.slice(afterStart)
  const rules = []
  let current = null
  for (const rawLine of block.split(/\r?\n/)) {
    const m = /^\s*(\d+)\.\s+(.*)$/.exec(rawLine)
    if (m) {
      if (current) rules.push(current)
      current = { n: Number(m[1]), text: m[2].trim() }
    } else if (current) {
      const cont = rawLine.trim()
      // Stop accreting a rule when a sub-heading / new section starts.
      if (/^#{1,6}\s/.test(cont)) {
        rules.push(current)
        current = null
      } else if (cont) {
        current.text += ' ' + cont
      }
    }
  }
  if (current) rules.push(current)
  return rules.map((r) => ({ n: r.n, text: sanitizeLine(r.text) })).filter((r) => r.text.length > 0)
}

// ---------- compliance predicates ----------

// Mechanically-decidable workflow predicates. Each is {id, label, status, detail}
// with status ∈ {pass, fail, na}. `na` (signal absent / predicate inapplicable)
// is preferred over a false `fail`. The nuanced judgement lives in the
// independent eval subagent — this is only the deterministic floor.
//
// signals (each field may be undefined → na):
//   hasCodeEdit            — did the session modify code?
//   branchCreatedBeforeEdit— bool: a feature branch was created before first edit
//   hasPr                  — a PR was referenced / opened
//   skillInvokedCount      — number of workflow-skill invocations
export function buildCompliance(signals = {}) {
  const { hasCodeEdit, branchCreatedBeforeEdit, hasPr, skillInvokedCount } = signals
  const out = []

  // 1. branch before code (AGENTS.md: 开始写代码前先建分支)
  if (!hasCodeEdit) {
    out.push({
      id: 'branch-before-code',
      label: '编码前先建分支',
      status: 'na',
      detail: '本会话没有代码修改，分支纪律不适用',
    })
  } else if (branchCreatedBeforeEdit === true) {
    out.push({
      id: 'branch-before-code',
      label: '编码前先建分支',
      status: 'pass',
      detail: '首次代码修改前观察到分支创建',
    })
  } else {
    out.push({
      id: 'branch-before-code',
      label: '编码前先建分支',
      status: branchCreatedBeforeEdit === false ? 'fail' : 'na',
      detail:
        branchCreatedBeforeEdit === false
          ? '有代码修改但未观察到先建分支'
          : '有代码修改但无法从日志判定分支创建时机',
    })
  }

  // 2. PR opened (AGENTS.md: 尽早提交 → Draft PR)
  out.push({
    id: 'pr-opened',
    label: '本会话开启了 PR',
    status: hasPr ? 'pass' : 'na',
    detail: hasPr ? '会话引用 / 开启了 PR' : '本会话未引用 PR，早提交纪律不适用',
  })

  // 3. skill engaged on code work (AGENTS.md: 非平凡实现走 skill 流程)
  if (!hasCodeEdit) {
    out.push({
      id: 'skill-on-code',
      label: '代码工作调用了 skill 流程',
      status: 'na',
      detail: '本会话没有代码修改',
    })
  } else {
    const n = skillInvokedCount || 0
    out.push({
      id: 'skill-on-code',
      label: '代码工作调用了 skill 流程',
      status: n > 0 ? 'pass' : 'fail',
      detail: n > 0 ? `会话调用了 ${n} 次 skill` : '有代码修改但全程零 skill 调用',
    })
  }

  return out
}
