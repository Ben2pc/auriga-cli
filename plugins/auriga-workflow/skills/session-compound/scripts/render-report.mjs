#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

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

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function validateData(mode, data) {
  if (!isObject(data)) fail('data must be a JSON object')
  if (mode === 'single') {
    if (!isObject(data.report_data)) fail('single data.report_data must be an object')
    for (const field of [
      'anomalies',
      'eval_findings',
      'observations',
      'experiments',
      'durable_candidates',
    ]) {
      if (field in data && !Array.isArray(data[field])) {
        fail(`single data.${field} must be an array`)
      }
    }
    return
  }
  if (!isObject(data.coverage)) fail('insights data.coverage must be an object')
  if (!isObject(data.at_a_glance)) fail('insights data.at_a_glance must be an object')
  if ('window' in data && !isObject(data.window)) {
    fail('insights data.window must be an object')
  }
  for (const field of [
    'project_areas',
    'wins',
    'frictions',
    'observations',
    'experiments',
    'durable_candidates',
    'evidence_limitations',
  ]) {
    if (field in data && !Array.isArray(data[field])) {
      fail(`insights data.${field} must be an array`)
    }
  }
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
if (data.mode !== mode) fail(`data.mode must equal ${mode}`)
validateData(mode, data)
const marker = '__REPORT_BUNDLE__'
const markerCount = template.split(marker).length - 1
if (markerCount !== 1) fail(`template must contain exactly one ${marker} marker`)
const html = template.replace(marker, safeJson(data))
fs.mkdirSync(path.dirname(outputFile), { recursive: true })
const temp = `${outputFile}.${process.pid}.${Date.now()}.tmp`
fs.writeFileSync(temp, html)
fs.renameSync(temp, outputFile)
process.stdout.write(`${JSON.stringify({ mode, output: outputFile })}\n`)
