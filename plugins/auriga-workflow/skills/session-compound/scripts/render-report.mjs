#!/usr/bin/env node

import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { reportValidationError } from './contracts.mjs'

function fail(message) {
  process.stderr.write(`[render-report] ${message}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith('--')) fail(`unknown argument: ${token}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail(`missing value for ${token}`)
    values[token.slice(2)] = value
    index++
  }
  return values
}

function required(values, key) {
  const value = values[key]
  if (!value) fail(`--${key} is required`)
  return value
}

function readText(file, label) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    fail(`cannot read ${label}: ${error.message}`)
  }
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function evidenceSessionsFromAggregate(aggregate) {
  if (!aggregate || aggregate.mode !== 'insights-aggregate') {
    fail('insights --aggregate must come from the aggregate command')
  }
  if (!Array.isArray(aggregate.representative_facets)) {
    fail('insights aggregate.representative_facets must be an array')
  }
  const seen = new Set()
  const sessions = []
  for (const [index, facet] of aggregate.representative_facets.entries()) {
    const sessionId = facet?.session_id
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      fail(`insights aggregate.representative_facets[${index}].session_id must be a string`)
    }
    if (seen.has(sessionId)) continue
    seen.add(sessionId)
    sessions.push({
      session_id: sessionId,
      title: typeof facet.project_area === 'string' && facet.project_area.trim()
        ? facet.project_area.trim()
        : '未命名会话',
      ended_at: typeof facet.ended_at === 'string' && Number.isFinite(Date.parse(facet.ended_at))
        ? facet.ended_at
        : null,
    })
  }
  return sessions
}

const args = parseArgs(process.argv.slice(2))
const mode = required(args, 'mode')
if (!['single', 'insights'].includes(mode)) fail('--mode must be single or insights')
const templateFile = required(args, 'template')
const dataFile = required(args, 'data')
const outputFile = required(args, 'output')
const template = readText(templateFile, 'template')
let data
try {
  data = JSON.parse(readText(dataFile, 'data'))
} catch (error) {
  fail(`data is not valid JSON: ${error.message}`)
}
const validationError = reportValidationError(mode, data)
if (validationError) fail(validationError)
if (mode === 'insights') {
  let aggregate
  try {
    aggregate = JSON.parse(readText(required(args, 'aggregate'), 'aggregate data'))
  } catch (error) {
    fail(`aggregate data is not valid JSON: ${error.message}`)
  }
  data = {
    ...data,
    evidence_sessions: evidenceSessionsFromAggregate(aggregate),
  }
}
const marker = '__REPORT_BUNDLE__'
const markerCount = template.split(marker).length - 1
if (markerCount !== 1) fail(`template must contain exactly one ${marker} marker`)
const html = template.replace(marker, safeJson(data))
fs.mkdirSync(path.dirname(outputFile), { recursive: true, mode: 0o700 })
try {
  if (fs.lstatSync(outputFile).isSymbolicLink()) fail('output path must not be a symbolic link')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
const temp = `${outputFile}.${process.pid}.${crypto.randomUUID()}.tmp`
const handle = fs.openSync(temp, 'wx', 0o600)
try {
  fs.writeFileSync(handle, html)
} finally {
  fs.closeSync(handle)
}
fs.renameSync(temp, outputFile)
fs.chmodSync(outputFile, 0o600)
process.stdout.write(`${JSON.stringify({ mode, output: outputFile })}\n`)
