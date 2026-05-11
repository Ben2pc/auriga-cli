#!/usr/bin/env node
/**
 * Claude Code session analyzer.
 *
 * Parses one ~/.claude/projects/<cwd-slug>/<session-id>.jsonl transcript
 * and emits a unified JSON shape (see schema.md) that the session-compound
 * HTML template can render.
 *
 * Usage:
 *   node claude-code.mjs                              # auto-locate current session
 *   node claude-code.mjs --session-id <uuid>          # explicit id
 *   node claude-code.mjs --project-slug <slug>        # override slug derivation
 *   node claude-code.mjs --file <abs-path>            # explicit file
 *
 * JSONL quirks handled (mirrors session-report's analyze-sessions.mjs):
 *  - A single API response is split into multiple type:"assistant" entries
 *    (one per content block) sharing the same requestId. Each carries the
 *    SAME final usage object, so summing naively triples/quadruples cost.
 *    -> dedupe by requestId, take usage once.
 *  - type:"user" entries include tool_result, interrupt markers, compact
 *    summaries and meta-injected text. Human messages are those where
 *    isSidechain/isMeta/isCompactSummary are falsy and content is a plain
 *    string (or text block) that isn't a tool_result or interrupt marker.
 *  - Resumed sessions can re-serialize prior entries; dedupe globally by
 *    entry uuid so replayed history isn't double-counted.
 *  - Many top-level types are noise for our purposes (ai-title, attachment,
 *    file-history-snapshot, last-prompt, permission-mode, queue-operation,
 *    system) — we ignore them after extracting any useful metadata.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

// ---------- CLI ----------
const argv = process.argv.slice(2)
function flag(name, dflt) {
  const i = argv.indexOf(name)
  if (i === -1) return dflt
  const v = argv[i + 1]
  return v === undefined || v.startsWith('--') ? true : v
}

const explicitFile = flag('--file', null)
const explicitId = flag('--session-id', null)
const explicitSlug = flag('--project-slug', null)
const PRETTY = argv.includes('--pretty')

// ---------- Locate session JSONL ----------
function projectsDir() {
  return path.join(os.homedir(), '.claude', 'projects')
}

function cwdSlug() {
  return process.cwd().replace(/\//g, '-')
}

function resolveFile() {
  if (explicitFile) return explicitFile
  const sid = explicitId || process.env.CLAUDE_CODE_SESSION_ID
  if (!sid) {
    throw new Error(
      'No session id: pass --session-id, --file, or run inside a Claude Code session (CLAUDE_CODE_SESSION_ID).',
    )
  }
  const slug = explicitSlug || cwdSlug()
  const p = path.join(projectsDir(), slug, `${sid}.jsonl`)
  if (!fs.existsSync(p)) {
    throw new Error(`Session file not found: ${p}`)
  }
  return p
}

// ---------- Stats containers ----------
function newStats() {
  return {
    cwd: null,
    sessionId: null,
    gitBranch: null,
    cliVersion: null,
    model: null,
    firstTs: null,
    lastTs: null,
    activeMs: 0,
    apiCalls: 0,
    inputUncached: 0,
    cacheCreate: 0,
    cacheRead: 0,
    output: 0,
    toolUses: {}, // name -> count
    toolUseEvents: [], // {ts, name, inputPreview}
    fileReads: {}, // path -> count
    seenRequestIds: new Set(),
    seenUuids: new Set(),
    humanTurns: [], // {ts, text, tokens, toolCounts}
    feedbackMoments: [], // {ts, text}
    skillInvocations: {}, // skill name -> count
    agentInvocations: [], // {ts, description, subagent_type}
    cacheBreaks: [], // {ts, uncached, totalInput}
    todosFinal: [], // last TodoWrite payload
  }
}

// Calibrated against ~85 real human messages from 10 sessions (5 claude +
// 5 codex). Single-character Chinese tokens like bare 别 / 停 were dropped:
// they pattern-match inside common compound words (特别 / 区别 / 类别 / 暂停 /
// 不停) and cause large false-positive volume. Multi-character feedback
// markers (停下 / 别用 / 别改) are kept via explicit bigrams or covered by
// other patterns (不要 / 改成 / 重做).
const FEEDBACK_RE = new RegExp(
  [
    // English — corrections, redirects, retractions
    String.raw`\b(no|don'?t|stop|wait|actually|nope|incorrect|wrong|instead|change|redo|revise|rewrite|should|shouldn'?t|remember|forget|nevermind|revert|undo|never\s+mind|hold\s+on)\b`,
    // Chinese — explicit corrections (bigram or longer; no bare 别/停)
    '不对|不要|别用|别改|别加|别再|停下|停一下|停止|其实|应该|错了|不是|改成|改下|换成|重新|重写|重做|修改',
    // Chinese — scope constraints (only-do, don't-need)
    '不用|只要|只需|只能|只用|只做|只看|只关注|只改|只管',
    // Chinese — appended asks / reminders
    '记得|别忘|忘了',
    // Chinese — suggestion-shaped
    '要不|要么',
    // Chinese — questioning / challenging
    '为啥|为什么不|为什么没|为何不|应该不|不该',
    // Chinese — "还是 X" pattern indicating the prior fix didn't land
    '还是.{0,8}(老|旧|错|没|不|没改|没修)',
  ].join('|'),
  'i',
)

const IDLE_GAP_MS = 5 * 60 * 1000

function tsToMs(ts) {
  if (!ts) return null
  const d = new Date(ts)
  const n = d.getTime()
  return Number.isFinite(n) ? n : null
}

function isHumanUserEntry(e) {
  if (e.type !== 'user') return false
  if (e.isSidechain) return false
  if (e.isMeta) return false
  if (e.isCompactSummary) return false
  const c = e.message?.content
  if (typeof c === 'string') {
    if (!c.trim()) return false
    if (c.startsWith('[Request interrupted')) return false
    if (c.startsWith('<command-')) return false
    if (c.startsWith('<local-command-stdout>')) return false
    return true
  }
  if (Array.isArray(c) && c[0]?.type === 'text') {
    const t = (c[0].text || '').trim()
    if (!t) return false
    if (t.startsWith('[Request interrupted')) return false
    if (t.startsWith('<command-')) return false
    return true
  }
  return false
}

function humanText(e) {
  const c = e.message?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c) && c[0]?.type === 'text') return c[0].text || ''
  return ''
}

function summarize(text, max = 120) {
  if (!text) return ''
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return cleaned.length <= max ? cleaned : cleaned.slice(0, max - 1) + '…'
}

// ---------- Main scan ----------
async function scan(filePath) {
  const stats = newStats()
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  let currentTurn = null

  for await (const raw of rl) {
    if (!raw) continue
    let e
    try {
      e = JSON.parse(raw)
    } catch {
      continue
    }

    // Global metadata
    if (!stats.cwd && e.cwd) stats.cwd = e.cwd
    if (!stats.sessionId && e.sessionId) stats.sessionId = e.sessionId
    if (!stats.gitBranch && e.gitBranch) stats.gitBranch = e.gitBranch

    const ts = tsToMs(e.timestamp)
    if (ts) {
      if (stats.firstTs == null || ts < stats.firstTs) stats.firstTs = ts
      if (stats.lastTs == null || ts > stats.lastTs) stats.lastTs = ts
    }

    if (e.uuid) {
      if (stats.seenUuids.has(e.uuid)) continue
      stats.seenUuids.add(e.uuid)
    }

    if (e.type === 'assistant') {
      handleAssistant(e, stats, currentTurn)
    } else if (e.type === 'user') {
      if (isHumanUserEntry(e)) {
        const text = humanText(e)
        currentTurn = {
          ts,
          text,
          summary: summarize(text),
          inputTokens: 0,
          outputTokens: 0,
          cacheCreate: 0,
          cacheRead: 0,
          toolCounts: {},
        }
        stats.humanTurns.push(currentTurn)
        if (FEEDBACK_RE.test(text)) {
          stats.feedbackMoments.push({ ts, text: summarize(text, 200) })
        }
      }
      // else: tool_result, sidechain — ignored for narrative
    }
    // other types ignored
  }

  // Active time: sum gaps <= IDLE_GAP_MS between human turns + first→last bracket
  if (stats.humanTurns.length >= 2) {
    let active = 0
    for (let i = 1; i < stats.humanTurns.length; i++) {
      const gap = (stats.humanTurns[i].ts || 0) - (stats.humanTurns[i - 1].ts || 0)
      if (gap > 0 && gap <= IDLE_GAP_MS) active += gap
    }
    stats.activeMs = active
  } else if (stats.firstTs && stats.lastTs) {
    stats.activeMs = Math.min(stats.lastTs - stats.firstTs, IDLE_GAP_MS)
  }

  return stats
}

function handleAssistant(e, stats, currentTurn) {
  const reqId = e.requestId
  const u = e.message?.usage
  const content = e.message?.content
  if (!stats.model && e.message?.model) stats.model = e.message.model

  // Tool-use tally per content block — every assistant fragment carries one
  // content block; we want every tool_use to count once regardless of
  // requestId dedup.
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'tool_use') {
        const name = block.name || 'unknown'
        stats.toolUses[name] = (stats.toolUses[name] || 0) + 1
        if (currentTurn) {
          currentTurn.toolCounts[name] = (currentTurn.toolCounts[name] || 0) + 1
        }
        stats.toolUseEvents.push({
          ts: tsToMs(e.timestamp),
          name,
          inputPreview: summarize(JSON.stringify(block.input || {}), 200),
        })
        // Track Read repetition for waste signal
        if (name === 'Read' && block.input?.file_path) {
          const fp = block.input.file_path
          stats.fileReads[fp] = (stats.fileReads[fp] || 0) + 1
        }
        // Skill invocations
        if (name === 'Skill' && block.input?.skill) {
          const skill = block.input.skill
          stats.skillInvocations[skill] = (stats.skillInvocations[skill] || 0) + 1
        }
        // Subagent dispatches
        if (name === 'Agent') {
          stats.agentInvocations.push({
            ts: tsToMs(e.timestamp),
            description: block.input?.description || '',
            subagent_type: block.input?.subagent_type || 'general-purpose',
          })
        }
        // TodoWrite — keep latest todos
        if (name === 'TodoWrite' && Array.isArray(block.input?.todos)) {
          stats.todosFinal = block.input.todos
        }
      }
    }
  }

  // Token usage: dedupe by requestId
  if (reqId && u) {
    if (!stats.seenRequestIds.has(reqId)) {
      stats.seenRequestIds.add(reqId)
      stats.apiCalls++
      stats.inputUncached += u.input_tokens || 0
      stats.cacheCreate += u.cache_creation_input_tokens || 0
      stats.cacheRead += u.cache_read_input_tokens || 0
      stats.output += u.output_tokens || 0
      if (currentTurn) {
        currentTurn.inputTokens += u.input_tokens || 0
        currentTurn.cacheCreate += u.cache_creation_input_tokens || 0
        currentTurn.cacheRead += u.cache_read_input_tokens || 0
        currentTurn.outputTokens += u.output_tokens || 0
      }
      // Cache break detection: a request with large uncached input means the
      // cache was discarded (or we paid to seed a new ephemeral block).
      // 50K is roughly "more than a typical CLAUDE.md + 1 file"; below that
      // an uncached input is normal seeding, not a break worth surfacing.
      const totalIn =
        (u.input_tokens || 0) +
        (u.cache_creation_input_tokens || 0) +
        (u.cache_read_input_tokens || 0)
      if ((u.input_tokens || 0) > 50_000) {
        stats.cacheBreaks.push({
          ts: tsToMs(e.timestamp),
          uncached: u.input_tokens || 0,
          totalInput: totalIn,
        })
      }
    } else if (currentTurn) {
      // requestId already seen but turn might not have it yet (shouldn't happen
      // if dedup is sound; defensive only).
    }
  }
}

// ---------- Emit ----------
function emit(stats, filePath) {
  const totalIn = stats.inputUncached + stats.cacheCreate + stats.cacheRead
  const cacheHitRate = totalIn > 0 ? stats.cacheRead / totalIn : 0
  const totalTokens = totalIn + stats.output

  // Per-turn tokens (sum input+output)
  const turnTokens = stats.humanTurns.map((t) => ({
    summary: t.summary,
    ts: t.ts,
    tokens:
      t.inputTokens + t.cacheCreate + t.cacheRead + t.outputTokens,
    toolCounts: t.toolCounts,
  }))
  const expensiveTurns = [...turnTokens]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5)

  // Waste signals
  const wasteSignals = []
  for (const [fp, count] of Object.entries(stats.fileReads)) {
    if (count >= 3) {
      wasteSignals.push({
        type: 'repeated_read',
        file: fp,
        count,
        note: `重复读同一文件 ${count}× — ${fp}`,
      })
    }
  }
  // Cache-hit floor: 85% is what a well-warmed session typically clears;
  // below 85% usually means system prompt / CLAUDE.md / a large file gets
  // re-included each turn. The 100K input gate prevents short sessions
  // (where one cold turn drags the average) from tripping the signal.
  if (cacheHitRate < 0.85 && totalIn > 100_000) {
    wasteSignals.push({
      type: 'low_cache_hit',
      rate: cacheHitRate,
      note: `Cache 命中率仅 ${(cacheHitRate * 100).toFixed(1)}% — system prompt 或 CLAUDE.md 可能在频繁失效`,
    })
  }

  // Skills / agents lists
  const skills = Object.entries(stats.skillInvocations).map(([name, count]) => ({
    name,
    count,
  }))
  const subagents = Object.entries(
    stats.agentInvocations.reduce((acc, a) => {
      acc[a.subagent_type] = (acc[a.subagent_type] || 0) + 1
      return acc
    }, {}),
  ).map(([type, count]) => ({ type, count }))

  return {
    cli: 'claude-code',
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source_file: filePath,
    session: {
      id: stats.sessionId,
      cwd: stats.cwd,
      started_at: stats.firstTs ? new Date(stats.firstTs).toISOString() : null,
      ended_at: stats.lastTs ? new Date(stats.lastTs).toISOString() : null,
      duration_ms:
        stats.firstTs && stats.lastTs ? stats.lastTs - stats.firstTs : 0,
      active_ms: stats.activeMs,
      model: stats.model,
      cli_version: null,
      git: stats.gitBranch ? { branch: stats.gitBranch } : null,
    },
    narrative: {
      human_turn_count: stats.humanTurns.length,
      human_turns: stats.humanTurns.map((t, i) => ({
        idx: i,
        ts: t.ts,
        summary: t.summary,
        tokens:
          t.inputTokens + t.cacheCreate + t.cacheRead + t.outputTokens,
        tool_counts: t.toolCounts,
      })),
      feedback_moments: stats.feedbackMoments,
      todos_final: stats.todosFinal,
    },
    health: {
      tokens: {
        input_uncached: stats.inputUncached,
        cache_create: stats.cacheCreate,
        cache_read: stats.cacheRead,
        output: stats.output,
        reasoning_output: 0, // claude doesn't expose
        total: totalTokens,
      },
      api_calls: stats.apiCalls,
      cache_hit_rate: cacheHitRate,
      context_window_used_pct: null, // claude doesn't expose
      tools: stats.toolUses,
      subagents,
      skills,
      expensive_turns: expensiveTurns,
      cache_breaks: stats.cacheBreaks,
      waste_signals: wasteSignals,
    },
    raw_for_compound: {
      feedback_moments: stats.feedbackMoments,
      repeated_reads: Object.entries(stats.fileReads)
        .filter(([, c]) => c >= 2)
        .map(([file, count]) => ({ file, count })),
      agent_invocations: stats.agentInvocations,
    },
  }
}

// ---------- Run ----------
;(async () => {
  try {
    const file = resolveFile()
    const stats = await scan(file)
    const out = emit(stats, file)
    process.stdout.write(
      PRETTY ? JSON.stringify(out, null, 2) : JSON.stringify(out),
    )
    process.stdout.write('\n')
  } catch (err) {
    process.stderr.write(`[claude-code analyzer] ${err.message}\n`)
    process.exit(1)
  }
})()
