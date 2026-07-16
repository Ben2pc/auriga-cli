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
