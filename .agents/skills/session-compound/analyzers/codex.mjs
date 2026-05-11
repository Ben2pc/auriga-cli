#!/usr/bin/env node
/**
 * Codex session analyzer.
 *
 * Parses one ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<thread-id>.jsonl
 * rollout file and emits the same unified JSON shape as claude-code.mjs.
 *
 * Usage:
 *   node codex.mjs                              # auto-locate current session via CODEX_THREAD_ID
 *   node codex.mjs --thread-id <uuid>           # explicit id
 *   node codex.mjs --file <abs-path>            # explicit rollout file
 *
 * JSONL shape (one obj per line):
 *   { timestamp, type, payload }
 * with type ∈ {session_meta, turn_context, event_msg, response_item}.
 *
 *   event_msg payloads:
 *     - user_message:  { message }
 *     - agent_message: { message, phase }       # phase=commentary|final
 *     - token_count:   { info: { total_token_usage, last_token_usage,
 *                                model_context_window }, rate_limits }
 *     - task_started / task_complete
 *
 *   response_item payloads:
 *     - message:               { role, content[] }       # duplicate of *_message
 *     - function_call:         { name, arguments(str), call_id }
 *     - function_call_output:  { call_id, output(str) }
 *     - reasoning:             { content?, summary? }
 *
 * Token accounting note: unlike Claude Code (which needs requestId dedup
 * because each response is split across many entries with duplicated usage),
 * Codex emits dedicated token_count events. The LAST token_count.info
 * .total_token_usage is the cumulative session total. Per-turn cost comes
 * from per-event last_token_usage attributed to the current human turn.
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
const explicitId =
  flag('--thread-id', null) || flag('--session-id', null) || null
const PRETTY = argv.includes('--pretty')

// ---------- Locate rollout JSONL ----------
function sessionsRoots() {
  return [
    path.join(os.homedir(), '.codex', 'sessions'),
    path.join(os.homedir(), '.codex', 'archived_sessions'),
  ]
}

function walkAndFind(dir, suffix) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      const sub = walkAndFind(full, suffix)
      if (sub) return sub
    } else if (ent.isFile() && ent.name.endsWith(suffix)) {
      return full
    }
  }
  return null
}

function resolveFile() {
  if (explicitFile) return explicitFile
  const id = explicitId || process.env.CODEX_THREAD_ID
  if (!id) {
    throw new Error(
      'No thread id: pass --thread-id, --file, or run inside a Codex session (CODEX_THREAD_ID).',
    )
  }
  const suffix = `-${id}.jsonl`
  for (const root of sessionsRoots()) {
    const f = walkAndFind(root, suffix)
    if (f) return f
  }
  throw new Error(
    `No rollout file ending with "${suffix}" under ~/.codex/sessions or ~/.codex/archived_sessions.`,
  )
}

// ---------- Stats ----------
function newStats() {
  return {
    sessionId: null,
    cwd: null,
    cliVersion: null,
    originator: null,
    model: null, // real model, pulled from turn_context (NOT session_meta.model_provider)
    modelProvider: null,
    forkedFromId: null,
    git: null,
    firstTs: null,
    lastTs: null,
    activeMs: 0,
    humanTurns: [], // {ts, text, summary, tokens, reasoningTokens, toolCounts}
    feedbackMoments: [],
    toolUses: {}, // name -> count (union of function_call.name + event-msg-driven tools)
    fileReads: {},
    lastCallByCallId: {},
    toolFailures: [],
    totalTokenUsage: null,
    modelContextWindow: null,
    taskStarted: false,
    taskCompleted: false,
    firstUserText: null,
    lastAgentFinalMessage: null,
    taskDurationMs: null,
    timeToFirstTokenMs: null,
    // Newly tracked (from source-code spelunking of RolloutItem + EventMsg):
    compactionCount: 0, // each context_compacted event = 1 auto-compaction
    turnAbortCount: 0, // user interrupted a turn
    patchApplies: { success: 0, failure: 0, failedFiles: [] }, // patch_apply_end events
    mcpToolCallCount: 0,
    customToolCallCount: 0,
    webSearchCount: 0,
    toolSearchCount: 0,
    imageGenerationCount: 0,
    agentInvocations: [], // {ts, subagent_type, message_preview, fork_context}
  }
}

// Kept identical to claude-code.mjs (see comment there for calibration notes).
const FEEDBACK_RE = new RegExp(
  [
    String.raw`\b(no|don'?t|stop|wait|actually|nope|incorrect|wrong|instead|change|redo|revise|rewrite|should|shouldn'?t|remember|forget|nevermind|revert|undo|never\s+mind|hold\s+on)\b`,
    // No bare 别/停 — pattern-matches inside 特别/区别/暂停/不停.
    '不对|不要|别用|别改|别加|别再|停下|停一下|停止|其实|应该|错了|不是|改成|改下|换成|重新|重写|重做|修改',
    '不用|只要|只需|只能|只用|只做|只看|只关注|只改|只管',
    '记得|别忘|忘了',
    '要不|要么',
    '为啥|为什么不|为什么没|为何不|应该不|不该',
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

function summarize(text, max = 120) {
  if (!text) return ''
  const cleaned = String(text).replace(/\s+/g, ' ').trim()
  return cleaned.length <= max ? cleaned : cleaned.slice(0, max - 1) + '…'
}

// Detect simple file-read commands inside exec_command args (`cat foo`,
// `head -n 50 bar`, etc.). Best-effort. Matches the read command either at
// the start of the line OR as the first segment of a pipeline / sequence —
// `cat foo | grep bar` and `head -n 50 x ; wc -l y` both yield `foo` / `x`.
// Reads buried later in a pipeline are still missed (rare in practice).
function extractReadPath(cmd) {
  if (!cmd) return null
  const cmdStr = Array.isArray(cmd) ? cmd.join(' ') : String(cmd)
  // Skip both short/long flags (`-n`, `--lines=50`) AND bare numeric values
  // that follow flags as a separate token (`head -n 50 foo.txt`). Without
  // the numeric skip we capture "50" as the path.
  const m = cmdStr.match(
    /(?:^|[;|&]\s*)\s*(?:cat|head|tail|less|nl|wc|file)\s+(?:(?:-\S+|-?\d+)\s+)*['"]?([^\s'"|;>&]+)['"]?/,
  )
  if (!m) return null
  const candidate = m[1]
  // Reject pure-numeric / pure-flag captures (defensive — should be handled
  // by the skip group, but flag formats vary).
  if (/^-?\d+$/.test(candidate) || candidate.startsWith('-')) return null
  return candidate
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

    const ts = tsToMs(e.timestamp)
    if (ts) {
      if (stats.firstTs == null || ts < stats.firstTs) stats.firstTs = ts
      if (stats.lastTs == null || ts > stats.lastTs) stats.lastTs = ts
    }

    const t = e.type
    const p = e.payload || {}

    if (t === 'session_meta') {
      stats.sessionId = p.id || stats.sessionId
      stats.cwd = p.cwd || stats.cwd
      stats.cliVersion = p.cli_version || stats.cliVersion
      stats.originator = p.originator || stats.originator
      stats.modelProvider = p.model_provider || stats.modelProvider
      stats.forkedFromId = p.forked_from_id || stats.forkedFromId
      if (p.git) {
        stats.git = {
          branch: p.git.branch || null,
          commit: p.git.commit_hash || null,
          repo: p.git.repository_url || null,
        }
      }
    } else if (t === 'turn_context') {
      // Real model name lives here (per protocol.rs TurnContextItem.model),
      // not in session_meta. Take the first one we see; later turn_contexts
      // would only override if the user switched models mid-session.
      if (!stats.model && p.model) stats.model = p.model
    } else if (t === 'compacted') {
      // Auto-compaction marker. We also count via event_msg/context_compacted
      // below; the two are emitted 1:1, but the rollout-item one carries the
      // replacement-history summary text. We only count once (in event_msg).
    } else if (t === 'event_msg') {
      handleEventMsg(p, ts, stats, (turn) => (currentTurn = turn))
    } else if (t === 'response_item') {
      handleResponseItem(p, ts, stats, currentTurn)
    }
  }

  // Active time
  if (stats.humanTurns.length >= 2) {
    let active = 0
    for (let i = 1; i < stats.humanTurns.length; i++) {
      const gap =
        (stats.humanTurns[i].ts || 0) - (stats.humanTurns[i - 1].ts || 0)
      if (gap > 0 && gap <= IDLE_GAP_MS) active += gap
    }
    stats.activeMs = active
  } else if (stats.firstTs && stats.lastTs) {
    stats.activeMs = Math.min(stats.lastTs - stats.firstTs, IDLE_GAP_MS)
  }

  return stats
}

function handleEventMsg(p, ts, stats, setTurn) {
  switch (p.type) {
    case 'user_message': {
      const text = p.message || ''
      if (!text.trim()) break
      if (stats.firstUserText === null) stats.firstUserText = text
      const turn = {
        ts,
        text,
        summary: summarize(text),
        tokens: 0,
        reasoningTokens: 0,
        toolCounts: {},
      }
      stats.humanTurns.push(turn)
      setTurn(turn)
      if (FEEDBACK_RE.test(text)) {
        stats.feedbackMoments.push({ ts, text: summarize(text, 200) })
      }
      break
    }
    case 'agent_message': {
      // Keep updating; the final "final-phase" message wins.
      if (p.phase !== 'commentary' && p.message) {
        stats.lastAgentFinalMessage = p.message
      } else if (!stats.lastAgentFinalMessage && p.message) {
        // Fallback for runs that never label a final phase.
        stats.lastAgentFinalMessage = p.message
      }
      break
    }
    case 'token_count': {
      const info = p.info
      if (!info) break
      if (info.total_token_usage) stats.totalTokenUsage = info.total_token_usage
      if (info.model_context_window) stats.modelContextWindow = info.model_context_window
      const turn = stats.humanTurns[stats.humanTurns.length - 1]
      if (turn && info.last_token_usage) {
        const l = info.last_token_usage
        turn.tokens +=
          (l.input_tokens || 0) +
          (l.output_tokens || 0) +
          (l.reasoning_output_tokens || 0)
        turn.reasoningTokens += l.reasoning_output_tokens || 0
      }
      break
    }
    case 'task_started':
      stats.taskStarted = true
      break
    case 'task_complete': {
      stats.taskCompleted = true
      if (p.last_agent_message) stats.lastAgentFinalMessage = p.last_agent_message
      stats.taskDurationMs = p.duration_ms || null
      stats.timeToFirstTokenMs = p.time_to_first_token_ms || null
      break
    }
    case 'turn_aborted':
      stats.turnAbortCount++
      break
    case 'context_compacted':
      stats.compactionCount++
      break
    case 'patch_apply_end': {
      // Authoritative source for code-edit success/failure (more reliable
      // than regex-matching function_call_output text).
      if (p.success === false) stats.patchApplies.failure++
      else stats.patchApplies.success++
      stats.toolUses['patch_apply'] = (stats.toolUses['patch_apply'] || 0) + 1
      const turn = stats.humanTurns[stats.humanTurns.length - 1]
      if (turn) turn.toolCounts['patch_apply'] = (turn.toolCounts['patch_apply'] || 0) + 1
      if (p.success === false) {
        const files = p.changes ? Object.keys(p.changes) : []
        stats.patchApplies.failedFiles.push(...files)
        stats.toolFailures.push({
          call_id: p.call_id,
          name: 'patch_apply',
          preview: (p.stderr || p.stdout || '').slice(0, 200),
          files,
        })
      }
      break
    }
    case 'mcp_tool_call_end':
      stats.mcpToolCallCount++
      stats.toolUses['mcp_tool_call'] = (stats.toolUses['mcp_tool_call'] || 0) + 1
      break
    case 'web_search_end':
      stats.webSearchCount++
      stats.toolUses['web_search'] = (stats.toolUses['web_search'] || 0) + 1
      break
    case 'image_generation_end':
      stats.imageGenerationCount++
      stats.toolUses['image_generation'] = (stats.toolUses['image_generation'] || 0) + 1
      break
  }
}

function handleResponseItem(p, ts, stats, currentTurn) {
  switch (p.type) {
    case 'function_call': {
      const name = p.name || 'unknown'
      stats.toolUses[name] = (stats.toolUses[name] || 0) + 1
      if (currentTurn) {
        currentTurn.toolCounts[name] = (currentTurn.toolCounts[name] || 0) + 1
      }
      let args = {}
      try {
        args = JSON.parse(p.arguments || '{}')
      } catch {
        // ignore arg parse errors
      }
      stats.lastCallByCallId[p.call_id] = { name, args }
      if (name === 'exec_command') {
        const fp = extractReadPath(args.cmd)
        if (fp) stats.fileReads[fp] = (stats.fileReads[fp] || 0) + 1
      }
      if (name === 'spawn_agent') {
        stats.agentInvocations.push({
          ts,
          subagent_type: args.agent_type || 'unknown',
          message_preview: summarize(args.message || '', 120),
          fork_context: args.fork_context ?? null,
        })
      }
      break
    }
    case 'function_call_output': {
      const out = p.output
      const outStr = typeof out === 'string' ? out : JSON.stringify(out || '')
      // Avoid double-counting patch failures (handled by patch_apply_end with
      // an authoritative `success` field). Skip the regex path when the call
      // we're tied to looks like a patch.
      const prev = stats.lastCallByCallId[p.call_id]
      const isPatch = prev && /apply.?patch|patch_apply/i.test(prev.name)
      // Only line-anchored, strong shell signals. The earlier broad patterns
      // (`Error:` / `failed\b` anywhere) generated heavy false positives on
      // legitimate output that happened to mention errors (logs, docs, JSON).
      // Codex's shell tool emits "Process exited with code N" on non-zero exit
      // verbatim, which is the authoritative signal.
      const FAILURE_RE = /^(?:Process exited with code [1-9]|.*: command not found|bash: line \d+:)/m
      if (!isPatch && FAILURE_RE.test(outStr)) {
        stats.toolFailures.push({
          call_id: p.call_id,
          name: prev?.name || 'unknown',
          preview: outStr.slice(0, 200),
        })
      }
      break
    }
    case 'custom_tool_call':
      stats.customToolCallCount++
      stats.toolUses['custom_tool_call'] = (stats.toolUses['custom_tool_call'] || 0) + 1
      if (currentTurn) {
        currentTurn.toolCounts['custom_tool_call'] =
          (currentTurn.toolCounts['custom_tool_call'] || 0) + 1
      }
      break
    case 'tool_search_call':
      stats.toolSearchCount++
      stats.toolUses['tool_search'] = (stats.toolUses['tool_search'] || 0) + 1
      if (currentTurn) {
        currentTurn.toolCounts['tool_search'] =
          (currentTurn.toolCounts['tool_search'] || 0) + 1
      }
      break
    case 'web_search_call':
      // Mirror counter; web_search_end (event_msg) is the authoritative count.
      break
    // 'message' / 'reasoning' / 'custom_tool_call_output' / 'tool_search_output'
    // duplicate or are paired outputs — counted via their *_call siblings.
  }
}

// ---------- Emit ----------
function emit(stats, filePath) {
  const tu = stats.totalTokenUsage || {}
  const totalInput = tu.input_tokens || 0
  const cached = tu.cached_input_tokens || 0
  const output = tu.output_tokens || 0
  const reasoningOut = tu.reasoning_output_tokens || 0
  const total = tu.total_tokens || totalInput + output
  const inputUncached = Math.max(0, totalInput - cached)
  const cacheHitRate = totalInput > 0 ? cached / totalInput : 0
  // Codex doesn't expose "current context occupancy" — total_token_usage is
  // cumulative across the session (input + cache_read + output + ...), so
  // ratio vs window is meaningless as a "fill" percentage. We leave the field
  // null and expose raw `model_context_window` and largest single-turn cost
  // (computed below) for the report to surface instead.
  const contextWindowUsedPct = null
  const reasoningOutputRatio = output > 0 ? reasoningOut / output : 0

  // Per-turn tokens
  const turnTokens = stats.humanTurns.map((t) => ({
    summary: t.summary,
    ts: t.ts,
    tokens: t.tokens,
    toolCounts: t.toolCounts,
  }))
  const expensiveTurns = [...turnTokens]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5)

  // Waste signals — embed the specific path / tool / file into `note`
  // so the rendered row is self-explanatory instead of vague counts.
  const wasteSignals = []
  for (const [fp, c] of Object.entries(stats.fileReads)) {
    if (c >= 3) {
      wasteSignals.push({
        type: 'repeated_read',
        file: fp,
        count: c,
        note: `重复读同一文件 ${c}× — ${fp}`,
      })
    }
  }
  if (cacheHitRate < 0.5 && totalInput > 50_000) {
    wasteSignals.push({
      type: 'low_cache_hit',
      rate: cacheHitRate,
      note: `Cache 命中率仅 ${(cacheHitRate * 100).toFixed(1)}% — prompt 可能在频繁失效`,
    })
  }
  if (reasoningOutputRatio > 0.5 && output > 10_000) {
    wasteSignals.push({
      type: 'high_reasoning_ratio',
      rate: reasoningOutputRatio,
      note: `Reasoning 占 output 的 ${(reasoningOutputRatio * 100).toFixed(1)}% — 任务可能过难或 prompt 不够清晰`,
    })
  }
  if (stats.compactionCount > 0) {
    wasteSignals.push({
      type: 'context_compacted',
      count: stats.compactionCount,
      note: `本次会话被自动压缩 ${stats.compactionCount} 次 — cumulative tokens 已不等于 live context`,
    })
  }
  if (stats.turnAbortCount > 0) {
    wasteSignals.push({
      type: 'turn_aborted',
      count: stats.turnAbortCount,
      note: `${stats.turnAbortCount} 次 turn 被中断`,
    })
  }
  if (stats.patchApplies.failure > 0) {
    // Dedupe failed file list, show top 3 + ellipsis.
    const uniqueFiles = [...new Set(stats.patchApplies.failedFiles)]
    const filePreview = uniqueFiles.slice(0, 3).join(', ')
    const more = uniqueFiles.length > 3 ? ` 等 ${uniqueFiles.length} 个文件` : ''
    wasteSignals.push({
      type: 'patch_apply_failure',
      count: stats.patchApplies.failure,
      files: uniqueFiles,
      note: `apply_patch 失败 ${stats.patchApplies.failure}×（成功 ${stats.patchApplies.success}×）${filePreview ? ` — ${filePreview}${more}` : ''}`,
    })
  }
  if (stats.toolFailures.length > 0) {
    // Aggregate by tool name so the user sees which tools are actually
    // blowing up, not just a raw count.
    const byName = stats.toolFailures.reduce((acc, f) => {
      acc[f.name || 'unknown'] = (acc[f.name || 'unknown'] || 0) + 1
      return acc
    }, {})
    const breakdown = Object.entries(byName)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([n, c]) => `${n} ×${c}`)
      .join(', ')
    wasteSignals.push({
      type: 'tool_failures',
      count: stats.toolFailures.length,
      breakdown: byName,
      note: `${stats.toolFailures.length} 次工具调用失败 — ${breakdown}`,
    })
  }

  // Sub-agents counted by subagent_type (mirrors claude-code analyzer's shape)
  const subagentByType = stats.agentInvocations.reduce((acc, a) => {
    acc[a.subagent_type] = (acc[a.subagent_type] || 0) + 1
    return acc
  }, {})
  const subagentList = Object.entries(subagentByType).map(([type, count]) => ({
    type,
    count,
  }))

  return {
    cli: 'codex',
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
      model_provider: stats.modelProvider,
      cli_version: stats.cliVersion,
      originator: stats.originator,
      forked_from_id: stats.forkedFromId,
      git: stats.git,
    },
    narrative: {
      task_title: summarize(stats.firstUserText || '', 100),
      task_conclusion: summarize(stats.lastAgentFinalMessage || '', 240),
      task_completed: stats.taskCompleted === true,
      task_duration_ms: stats.taskDurationMs,
      time_to_first_token_ms: stats.timeToFirstTokenMs,
      human_turn_count: stats.humanTurns.length,
      human_turns: stats.humanTurns.map((t, i) => ({
        idx: i,
        ts: t.ts,
        summary: t.summary,
        tokens: t.tokens,
        tool_counts: t.toolCounts,
      })),
      feedback_moments: stats.feedbackMoments,
      todos_final: [],
    },
    health: {
      tokens: {
        input_uncached: inputUncached,
        cache_create: 0, // codex doesn't expose this
        cache_read: cached,
        output: output,
        reasoning_output: reasoningOut,
        total: total,
      },
      api_calls: null, // codex doesn't make this directly visible
      cache_hit_rate: cacheHitRate,
      context_window: stats.modelContextWindow,
      context_window_used_pct: contextWindowUsedPct,
      reasoning_output_ratio: reasoningOutputRatio,
      tools: stats.toolUses,
      subagents: subagentList,
      skills: [], // codex has no skill concept (uses plugins instead)
      expensive_turns: expensiveTurns,
      cache_breaks: [],
      waste_signals: wasteSignals,
      // Codex-specific extras (claude analyzer doesn't emit these)
      compaction_count: stats.compactionCount,
      turn_aborted_count: stats.turnAbortCount,
      patch_apply: stats.patchApplies,
      mcp_tool_call_count: stats.mcpToolCallCount,
      custom_tool_call_count: stats.customToolCallCount,
      web_search_count: stats.webSearchCount,
      tool_search_count: stats.toolSearchCount,
      image_generation_count: stats.imageGenerationCount,
    },
    raw_for_compound: {
      feedback_moments: stats.feedbackMoments,
      repeated_reads: Object.entries(stats.fileReads)
        .filter(([, c]) => c >= 2)
        .map(([file, count]) => ({ file, count })),
      tool_failures: stats.toolFailures,
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
    process.stderr.write(`[codex analyzer] ${err.message}\n`)
    process.exit(1)
  }
})()
