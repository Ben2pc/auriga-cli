#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ANALYSIS_PROMPT_VERSION,
  FACET_SCHEMA_VERSION,
  facetValidationError,
} from './contracts.mjs'

const DEFAULT_DAYS = 30
const DEFAULT_BUDGET = 50

function fail(message) {
  process.stderr.write(`[insights-pipeline] ${message}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const args = { command, values: {} }
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index]
    if (!token.startsWith('--')) fail(`unknown argument: ${token}`)
    const key = token.slice(2)
    const value = rest[index + 1]
    if (!value || value.startsWith('--')) fail(`missing value for --${key}`)
    if (key === 'sessions-root' || key === 'facet') {
      args.values[key] = [...(args.values[key] || []), value]
    } else {
      args.values[key] = value
    }
    index++
  }
  return args
}

function required(values, key) {
  const value = values[key]
  if (value == null || value === '') fail(`--${key} is required`)
  return value
}

function positiveInt(value, fallback, label) {
  if (value == null) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) fail(`${label} must be a positive integer`)
  return parsed
}

function managedVersion(values, key, expected) {
  if (values[key] != null && String(values[key]) !== String(expected)) {
    fail(`--${key} is managed by this skill and must equal ${expected}`)
  }
  return String(expected)
}

function defaultSessionRoots(runtime) {
  const home = os.homedir()
  if (runtime === 'codex') {
    return [
      path.join(home, '.codex', 'sessions'),
      path.join(home, '.codex', 'archived_sessions'),
    ]
  }
  if (runtime === 'claude-code') return [path.join(home, '.claude', 'projects')]
  fail(`unsupported runtime: ${runtime}`)
}

function walkJsonl(root, output = []) {
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return output
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory() && entry.name !== 'subagents') walkJsonl(full, output)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) output.push(full)
  }
  return output
}

function parseTime(value) {
  const time = Date.parse(value || '')
  return Number.isFinite(time) ? time : null
}

function textFromClaudeUser(entry) {
  const content = entry.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text')
    .map((block) => block.text || '')
    .join('\n')
}

function inspectSession(file, runtime) {
  let sessionId = null
  let cwd = null
  let firstTs = null
  let lastTs = null
  let humanTurns = 0
  let completed = false
  let isSubagent = false
  let content
  let stat
  try {
    stat = fs.statSync(file)
    content = fs.readFileSync(file, 'utf8')
  } catch (error) {
    const fallbackTs = stat?.mtimeMs || null
    return {
      runtime,
      session_id: path.basename(file, '.jsonl').replace(/^rollout-/, ''),
      source_file: file,
      cwd: null,
      started_at: fallbackTs == null ? null : new Date(fallbackTs).toISOString(),
      ended_at: fallbackTs == null ? null : new Date(fallbackTs).toISOString(),
      human_turn_count: 0,
      completed: false,
      content_fingerprint: null,
      parse_error_count: 0,
      read_error: error.message,
    }
  }
  let parseErrors = 0
  const lines = content.split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      parseErrors++
      continue
    }
    const ts = parseTime(entry.timestamp)
    if (ts != null) {
      if (firstTs == null || ts < firstTs) firstTs = ts
      if (lastTs == null || ts > lastTs) lastTs = ts
    }
    if (runtime === 'codex') {
      const payload = entry.payload || {}
      if (entry.type === 'session_meta') {
        sessionId ||= payload.id || null
        cwd ||= payload.cwd || null
        const source = payload.source
        if (
          (source && typeof source === 'object' && source.subagent) ||
          (typeof source === 'string' && source.toLowerCase().includes('subagent'))
        ) {
          isSubagent = true
        }
      }
      if (
        entry.type === 'event_msg' &&
        payload.type === 'user_message' &&
        String(payload.message || '').trim()
      ) {
        humanTurns++
      }
      if (entry.type === 'event_msg' && payload.type === 'task_complete') completed = true
    } else {
      sessionId ||= entry.sessionId || null
      cwd ||= entry.cwd || null
      if (entry.type === 'user' && textFromClaudeUser(entry).trim()) humanTurns++
      if (entry.type === 'result' || entry.subtype === 'turn_duration') completed = true
    }
  }
  sessionId ||= path.basename(file, '.jsonl').replace(/^rollout-/, '')
  if (firstTs == null && stat?.mtimeMs) firstTs = stat.mtimeMs
  if (lastTs == null && stat?.mtimeMs) lastTs = stat.mtimeMs
  return {
    runtime,
    session_id: sessionId,
    source_file: file,
    cwd,
    started_at: firstTs == null ? null : new Date(firstTs).toISOString(),
    ended_at: lastTs == null ? null : new Date(lastTs).toISOString(),
    human_turn_count: humanTurns,
    completed,
    is_subagent: isSubagent,
    content_fingerprint: crypto.createHash('sha256').update(content).digest('hex'),
    parse_error_count: parseErrors,
    read_error: null,
  }
}

function safeSessionId(sessionId) {
  return String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '_')
}

function cacheFile(cacheRoot, runtime, sessionId) {
  return path.join(cacheRoot, 'facets', runtime, `${safeSessionId(sessionId)}.json`)
}

function readCache(file, descriptor, schemaVersion, promptVersion) {
  let entry
  try {
    entry = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { state: fs.existsSync(file) ? 'invalid' : 'miss' }
  }
  const contract = entry.cache_contract || {}
  if (
    contract.runtime !== descriptor.runtime ||
    contract.session_id !== descriptor.session_id ||
    contract.content_fingerprint !== descriptor.content_fingerprint ||
    String(contract.facet_schema_version) !== String(schemaVersion) ||
    String(contract.analysis_prompt_version) !== String(promptVersion)
  ) {
    return { state: 'stale' }
  }
  if (
    !entry.facet ||
    entry.facet.session_id !== descriptor.session_id ||
    facetValidationError(entry.facet, 'cached facet')
  ) {
    return { state: 'invalid' }
  }
  return { state: 'hit', facet: entry.facet }
}

function prepare(values) {
  const runtime = required(values, 'runtime')
  if (!['codex', 'claude-code'].includes(runtime)) fail(`unsupported runtime: ${runtime}`)
  const roots = values['sessions-root'] || defaultSessionRoots(runtime)
  const cacheRoot = values['cache-root'] || path.join(os.homedir(), '.cache', 'auriga-cli', 'session-compound')
  const now = parseTime(values.now || new Date().toISOString())
  if (now == null) fail('--now must be an ISO-8601 timestamp')
  const days = positiveInt(values.days, DEFAULT_DAYS, '--days')
  const budget = positiveInt(values.budget, DEFAULT_BUDGET, '--budget')
  const schemaVersion = managedVersion(values, 'facet-schema-version', FACET_SCHEMA_VERSION)
  const promptVersion = managedVersion(values, 'prompt-version', ANALYSIS_PROMPT_VERSION)
  const cutoff = now - days * 24 * 60 * 60 * 1000

  const files = [...new Set(roots.flatMap((root) => walkJsonl(root)))].sort()
  const recentCandidates = files.filter((file) => {
    try {
      const modified = fs.statSync(file).mtimeMs
      return modified >= cutoff
    } catch {
      return true
    }
  })
  const descriptors = recentCandidates.map((file) => inspectSession(file, runtime))
  const rawInWindow = descriptors.filter((descriptor) => {
    const ended = parseTime(descriptor.ended_at)
    return ended != null && ended >= cutoff && ended <= now
  })
  const subagents = rawInWindow.filter((descriptor) => descriptor.is_subagent)
  const inWindow = rawInWindow.filter((descriptor) => !descriptor.is_subagent)
  const eligible = inWindow.filter(
    (descriptor) =>
      descriptor.session_id &&
      descriptor.content_fingerprint &&
      descriptor.parse_error_count === 0 &&
      !descriptor.read_error &&
      descriptor.human_turn_count > 0,
  )
  const cachedFacets = []
  const cachedFacetTimes = {}
  const uncached = []
  let invalidCache = 0
  for (const descriptor of eligible) {
    const cached = readCache(
      cacheFile(cacheRoot, runtime, descriptor.session_id),
      descriptor,
      schemaVersion,
      promptVersion,
    )
    if (cached.state === 'hit') {
      cachedFacets.push(cached.facet)
      cachedFacetTimes[descriptor.session_id] = descriptor.ended_at
    }
    else {
      if (cached.state === 'invalid') invalidCache++
      uncached.push(descriptor)
    }
  }
  uncached.sort((a, b) => String(b.ended_at).localeCompare(String(a.ended_at)))
  const analysisQueue = uncached.slice(0, budget)
  const deferred = Math.max(0, uncached.length - analysisQueue.length)
  return {
    mode: 'insights-prepare',
    runtime,
    window: {
      days,
      started_at: new Date(cutoff).toISOString(),
      ended_at: new Date(now).toISOString(),
    },
    cache_contract: {
      facet_schema_version: schemaVersion,
      analysis_prompt_version: promptVersion,
    },
    coverage: {
      discovered: files.length,
      in_window: inWindow.length,
      eligible: eligible.length,
      excluded: inWindow.length - eligible.length,
      excluded_subagents: subagents.length,
      excluded_damaged: inWindow.filter(
        (descriptor) => descriptor.parse_error_count > 0 || descriptor.read_error,
      ).length,
      cache_hits: cachedFacets.length,
      queued: analysisQueue.length,
      deferred,
      invalid_cache: invalidCache,
    },
    cached_facets: cachedFacets,
    cached_facet_times: cachedFacetTimes,
    analysis_queue: analysisQueue,
  }
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    fail(`cannot read ${label}: ${error.message}`)
  }
}

function atomicWriteJson(file, value, mode = 0o600) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    fs.chmodSync(dir, 0o700)
  } catch {
    // Best effort on filesystems that do not support POSIX permissions.
  }
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode })
  fs.renameSync(temp, file)
  try {
    fs.chmodSync(file, mode)
  } catch {
    // Best effort on filesystems that do not support POSIX permissions.
  }
}

function storeFacet(values) {
  const descriptor = readJson(required(values, 'descriptor'), 'descriptor')
  const facetFiles = required(values, 'facet')
  const facetFile = Array.isArray(facetFiles) ? facetFiles[0] : facetFiles
  if (Array.isArray(facetFiles) && facetFiles.length !== 1) {
    fail('store accepts exactly one --facet file')
  }
  const facet = validateFacet(readJson(facetFile, 'facet'), 'facet')
  const schemaVersion = managedVersion(values, 'facet-schema-version', FACET_SCHEMA_VERSION)
  const promptVersion = managedVersion(values, 'prompt-version', ANALYSIS_PROMPT_VERSION)
  const cacheRoot = values['cache-root'] || path.join(os.homedir(), '.cache', 'auriga-cli', 'session-compound')
  if (facet.session_id !== descriptor.session_id) {
    fail('facet.session_id does not match descriptor.session_id')
  }
  const entry = {
    cache_contract: {
      runtime: descriptor.runtime,
      session_id: descriptor.session_id,
      content_fingerprint: descriptor.content_fingerprint,
      facet_schema_version: schemaVersion,
      analysis_prompt_version: promptVersion,
    },
    cached_at: new Date().toISOString(),
    descriptor: {
      source_file: descriptor.source_file,
      started_at: descriptor.started_at,
      ended_at: descriptor.ended_at,
      cwd: descriptor.cwd,
    },
    facet,
  }
  const file = cacheFile(cacheRoot, descriptor.runtime, descriptor.session_id)
  atomicWriteJson(file, entry)
  return { stored: true, cache_file: file, session_id: descriptor.session_id }
}

function validateFacet(facet, label) {
  const error = facetValidationError(facet, label)
  if (error) fail(error)
  return facet
}

function aggregate(values) {
  const prepared = readJson(required(values, 'prepared'), 'prepared input')
  if (prepared.mode !== 'insights-prepare') {
    fail('prepared input must come from the prepare command')
  }
  const maxFacets = positiveInt(values['max-facets'], 80, '--max-facets')
  const maxBytes = positiveInt(values['max-bytes'], 200 * 1024, '--max-bytes')
  const incoming = []
  for (const file of values.facet || []) {
    const value = readJson(file, `facet file ${file}`)
    if (Array.isArray(value)) incoming.push(...value)
    else incoming.push(value)
  }
  const deduped = new Map()
  const cachedIds = new Set((prepared.cached_facets || []).map((facet) => facet.session_id))
  const queuedIds = new Set((prepared.analysis_queue || []).map((descriptor) => descriptor.session_id))
  const incomingIds = new Set()
  for (const [index, facet] of [
    ...(prepared.cached_facets || []),
    ...incoming,
  ].entries()) {
    const validated = validateFacet(facet, `facet ${index}`)
    if (index >= (prepared.cached_facets || []).length) {
      if (queuedIds.size > 0 && !queuedIds.has(validated.session_id)) {
        fail(`facet ${index}.session_id was not queued: ${validated.session_id}`)
      }
      incomingIds.add(validated.session_id)
    }
    deduped.set(validated.session_id, validated)
  }
  const facets = [...deduped.values()]
  const outcomeCounts = {}
  const projectAreaCounts = {}
  let wins = 0
  let frictions = 0
  let userInstructions = 0
  for (const facet of facets) {
    outcomeCounts[facet.outcome] = (outcomeCounts[facet.outcome] || 0) + 1
    const area = facet.project_area || 'unknown'
    projectAreaCounts[area] = (projectAreaCounts[area] || 0) + 1
    wins += facet.wins.length
    frictions += facet.frictions.length
    userInstructions += facet.user_instructions.length
  }
  const signalScore = (facet) =>
    Number(facet.wins.length > 0) +
    Number(facet.frictions.length > 0) +
    Number(facet.user_instructions.length > 0)
  const endedAtBySession = {
    ...(prepared.cached_facet_times || {}),
    ...Object.fromEntries(
      (prepared.analysis_queue || []).map((descriptor) => [descriptor.session_id, descriptor.ended_at]),
    ),
  }
  const byProject = new Map()
  for (const facet of facets) {
    const project = facet.project_area || 'unknown'
    if (!byProject.has(project)) byProject.set(project, [])
    byProject.get(project).push({
      ...facet,
      ended_at: endedAtBySession[facet.session_id] || null,
    })
  }
  const projectQueues = [...byProject.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, projectFacets]) =>
      projectFacets.sort((left, right) => {
        const scoreDiff = signalScore(right) - signalScore(left)
        if (scoreDiff !== 0) return scoreDiff
        const timeDiff = String(right.ended_at || '').localeCompare(String(left.ended_at || ''))
        if (timeDiff !== 0) return timeDiff
        return String(left.session_id).localeCompare(String(right.session_id))
      }),
    )
  const representativeFacets = []
  let representativeBytes = 2
  while (
    representativeFacets.length < maxFacets &&
    projectQueues.some((queue) => queue.length > 0)
  ) {
    for (const queue of projectQueues) {
      if (queue.length && representativeFacets.length < maxFacets) {
        const candidate = queue.shift()
        const candidateBytes = Buffer.byteLength(JSON.stringify(candidate)) +
          (representativeFacets.length > 0 ? 1 : 0)
        if (representativeBytes + candidateBytes <= maxBytes) {
          representativeFacets.push(candidate)
          representativeBytes += candidateBytes
        }
      }
    }
  }
  return {
    mode: 'insights-aggregate',
    runtime: prepared.runtime,
    window: prepared.window,
    coverage: {
      ...(prepared.coverage || {}),
      analyzed: facets.length,
      newly_analyzed: [...incomingIds].filter((id) => !cachedIds.has(id)).length,
      failed: Math.max(
        0,
        (prepared.coverage?.queued || queuedIds.size) -
          [...incomingIds].filter((id) => queuedIds.size === 0 || queuedIds.has(id)).length,
      ),
      semantic_budget_deferred: Math.max(0, facets.length - representativeFacets.length),
      representative_count: representativeFacets.length,
      not_semantically_analyzed: Math.max(
        0,
        (prepared.coverage?.eligible || 0) - facets.length,
      ),
    },
    mechanical: {
      outcome_counts: outcomeCounts,
      project_area_counts: projectAreaCounts,
      wins,
      frictions,
      user_instructions: userInstructions,
    },
    all_facet_count: facets.length,
    representative_count: representativeFacets.length,
    representative_bytes: representativeBytes,
    representative_facets: representativeFacets,
  }
}

function compactValue(value, maxArray, maxString) {
  if (typeof value === 'string') {
    return value.length > maxString ? `${value.slice(0, maxString - 1)}…` : value
  }
  if (Array.isArray(value)) {
    const kept = value.length <= maxArray
      ? value
      : [
          ...value.slice(0, Math.ceil(maxArray / 2)),
          ...value.slice(-Math.floor(maxArray / 2)),
        ]
    return kept.map((item) => compactValue(item, maxArray, maxString))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, compactValue(item, maxArray, maxString)]),
    )
  }
  return value
}

function compactEvidence(values) {
  const evidence = readJson(required(values, 'evidence'), 'session evidence')
  const maxBytes = positiveInt(values['max-bytes'], 64 * 1024, '--max-bytes')
  const originalBytes = Buffer.byteLength(JSON.stringify(evidence))
  for (const [maxArray, maxString] of [[50, 2000], [24, 1200], [12, 600], [6, 300]]) {
    const compacted = compactValue(evidence, maxArray, maxString)
    compacted.evidence_truncated = originalBytes > Buffer.byteLength(JSON.stringify(compacted))
    compacted.original_bytes = originalBytes
    const encoded = JSON.stringify(compacted)
    if (Buffer.byteLength(encoded) + 1 <= maxBytes) return compacted
  }
  fail(`session evidence cannot fit within ${maxBytes} bytes`)
}

function createWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'auriga-session-compound-'))
  fs.chmodSync(workspace, 0o700)
  return workspace
}

const parsed = parseArgs(process.argv.slice(2))
if (parsed.command === 'prepare') {
  process.stdout.write(`${JSON.stringify(prepare(parsed.values), null, 2)}\n`)
} else if (parsed.command === 'store') {
  process.stdout.write(`${JSON.stringify(storeFacet(parsed.values), null, 2)}\n`)
} else if (parsed.command === 'aggregate') {
  process.stdout.write(`${JSON.stringify(aggregate(parsed.values), null, 2)}\n`)
} else if (parsed.command === 'compact-evidence') {
  process.stdout.write(`${JSON.stringify(compactEvidence(parsed.values))}\n`)
} else if (parsed.command === 'workspace') {
  process.stdout.write(`${createWorkspace()}\n`)
} else {
  fail('expected command: workspace, prepare, compact-evidence, store, or aggregate')
}
