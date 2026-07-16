export const SESSION_EVIDENCE_SCHEMA_VERSION = 2
export const FACET_SCHEMA_VERSION = '2'
export const ANALYSIS_PROMPT_VERSION = '2'

const OUTCOMES = new Set(['fully_achieved', 'partially_achieved', 'not_achieved', 'unknown'])
const OWNERS = new Set(['agent', 'user', 'environment', 'unknown'])
const PERSISTENCE = new Set(['explicit-persistent', 'session-only', 'unspecified'])
const CANDIDATE_TYPES = new Set([
  'agent-context',
  'existing-skill',
  'new-skill',
  'reviewer',
  'mechanism',
])
const EVIDENCE_NATURE = new Set([
  'historical-snapshot',
  'current-state-lookback',
  'explicit-user-signal',
  'model-analysis',
])

function objectError(value, label, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `${label} must be a JSON object`
  }
  for (const field of required) {
    if (!(field in value)) return `${label} is missing required field: ${field}`
  }
  const allowed = new Set([...required, ...optional])
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) return `${label} has unexpected field: ${field}`
  }
  return null
}

function stringError(value, label, max = 1200, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') return `${label} must be a string`
  if (!allowEmpty && !value.trim()) return `${label} must be a non-empty string`
  if (value.length > max) return `${label} exceeds ${max} characters`
  return null
}

function arrayError(value, label, max = 100) {
  if (!Array.isArray(value)) return `${label} must be an array`
  if (value.length > max) return `${label} exceeds ${max} items`
  return null
}

function evidenceRefsError(value, label, { allowEmpty = false } = {}) {
  const array = arrayError(value, label, 50)
  if (array) return array
  if (!allowEmpty && value.length === 0) return `${label} must contain at least one reference`
  for (const [index, ref] of value.entries()) {
    const error = stringError(ref, `${label}[${index}]`, 256)
    if (error) return error
  }
  return null
}

function validateWin(item, label) {
  let error = objectError(item, label, ['text', 'evidence_refs'])
  if (error) return error
  return stringError(item.text, `${label}.text`, 800) ||
    evidenceRefsError(item.evidence_refs, `${label}.evidence_refs`)
}

function validateFriction(item, label) {
  let error = objectError(item, label, ['owner', 'text', 'consequence', 'evidence_refs'])
  if (error) return error
  if (!OWNERS.has(item.owner)) return `${label}.owner is not recognized`
  return stringError(item.text, `${label}.text`, 800) ||
    stringError(item.consequence, `${label}.consequence`, 800) ||
    evidenceRefsError(item.evidence_refs, `${label}.evidence_refs`)
}

function validateInstruction(item, label) {
  let error = objectError(item, label, ['text', 'persistence', 'evidence_refs'])
  if (error) return error
  if (!PERSISTENCE.has(item.persistence)) return `${label}.persistence is not recognized`
  return stringError(item.text, `${label}.text`, 800) ||
    evidenceRefsError(item.evidence_refs, `${label}.evidence_refs`)
}

export function facetValidationError(facet, label = 'facet') {
  const required = [
    'session_id',
    'project_area',
    'underlying_goal',
    'outcome',
    'wins',
    'frictions',
    'user_instructions',
    'brief_summary',
    'evidence_refs',
  ]
  let error = objectError(facet, label, required)
  if (error) return error
  for (const [field, max] of [
    ['session_id', 256],
    ['project_area', 160],
    ['underlying_goal', 1200],
    ['brief_summary', 2000],
  ]) {
    error = stringError(facet[field], `${label}.${field}`, max)
    if (error) return error
  }
  if (!OUTCOMES.has(facet.outcome)) return `${label}.outcome is not recognized`
  for (const [field, validator] of [
    ['wins', validateWin],
    ['frictions', validateFriction],
    ['user_instructions', validateInstruction],
  ]) {
    error = arrayError(facet[field], `${label}.${field}`, 30)
    if (error) return error
    for (const [index, item] of facet[field].entries()) {
      error = validator(item, `${label}.${field}[${index}]`)
      if (error) return error
    }
  }
  error = evidenceRefsError(facet.evidence_refs, `${label}.evidence_refs`)
  if (error) return error
  if (Buffer.byteLength(JSON.stringify(facet)) > 16 * 1024) {
    return `${label} exceeds the 16 KiB cache limit`
  }
  return null
}

function validateObservation(item, label) {
  let error = objectError(item, label, ['title', 'text', 'evidence_refs'])
  if (error) return error
  return stringError(item.title, `${label}.title`, 240) ||
    stringError(item.text, `${label}.text`, 1200) ||
    evidenceRefsError(item.evidence_refs, `${label}.evidence_refs`)
}

function validateExperiment(item, label) {
  let error = objectError(item, label, [
    'title',
    'text',
    'trial',
    'success_signal',
    'evidence_refs',
  ])
  if (error) return error
  return stringError(item.title, `${label}.title`, 240) ||
    stringError(item.text, `${label}.text`, 1200) ||
    stringError(item.trial, `${label}.trial`, 1200) ||
    stringError(item.success_signal, `${label}.success_signal`, 800) ||
    evidenceRefsError(item.evidence_refs, `${label}.evidence_refs`)
}

function validateCandidate(item, label) {
  let error = objectError(item, label, [
    'name',
    'type',
    'text',
    'why_durable',
    'default_selected',
    'evidence_refs',
  ])
  if (error) return error
  if (!CANDIDATE_TYPES.has(item.type)) return `${label}.type is not recognized`
  if (item.default_selected !== false) return `${label}.default_selected must be false`
  return stringError(item.name, `${label}.name`, 240) ||
    stringError(item.text, `${label}.text`, 2000) ||
    stringError(item.why_durable, `${label}.why_durable`, 1000) ||
    evidenceRefsError(item.evidence_refs, `${label}.evidence_refs`)
}

function validateEvalFinding(item, label) {
  let error = objectError(
    item,
    label,
    ['kind', 'polarity', 'confidence', 'evidence_nature', 'evidence_refs', 'text'],
    ['severity', 'skill'],
  )
  if (error) return error
  if (!new Set(['recall', 'compliance', 'skill-eval']).has(item.kind)) return `${label}.kind is not recognized`
  if (!new Set(['positive', 'gap']).has(item.polarity)) return `${label}.polarity is not recognized`
  if (!new Set(['high', 'med', 'low']).has(item.confidence)) return `${label}.confidence is not recognized`
  if (item.polarity === 'gap' && !new Set(['high', 'med', 'low']).has(item.severity)) {
    return `${label}.severity is required for gaps`
  }
  if (item.polarity === 'positive' && item.severity != null) return `${label}.severity must be omitted for positives`
  if (!EVIDENCE_NATURE.has(item.evidence_nature)) return `${label}.evidence_nature is not recognized`
  return stringError(item.text, `${label}.text`, 1600) ||
    (item.skill == null ? null : stringError(item.skill, `${label}.skill`, 240)) ||
    evidenceRefsError(item.evidence_refs, `${label}.evidence_refs`)
}

function validateCoverage(coverage, label) {
  const required = [
    'discovered',
    'in_window',
    'eligible',
    'analyzed',
    'cache_hits',
    'newly_analyzed',
    'failed',
    'queued',
    'excluded',
    'excluded_subagents',
    'excluded_damaged',
    'deferred',
    'semantic_budget_deferred',
    'not_semantically_analyzed',
    'invalid_cache',
    'representative_count',
  ]
  let error = objectError(coverage, label, required)
  if (error) return error
  for (const field of Object.keys(coverage)) {
    if (!Number.isInteger(coverage[field]) || coverage[field] < 0) {
      return `${label}.${field} must be a non-negative integer`
    }
  }
  return null
}

function validateArrayItems(value, label, validator, max = 50) {
  let error = arrayError(value, label, max)
  if (error) return error
  for (const [index, item] of value.entries()) {
    error = validator(item, `${label}[${index}]`)
    if (error) return error
  }
  return null
}

function validateSingle(data) {
  const required = [
    'mode',
    'report_data',
    'narrative_summary',
    'anomalies',
    'eval_findings',
    'observations',
    'experiments',
    'durable_candidates',
  ]
  let error = objectError(data, 'single data', required)
  if (error) return error
  if (!data.report_data || typeof data.report_data !== 'object' || Array.isArray(data.report_data)) {
    return 'single data.report_data must be an object'
  }
  if (data.report_data.schema_version !== SESSION_EVIDENCE_SCHEMA_VERSION) {
    return `single data.report_data.schema_version must equal ${SESSION_EVIDENCE_SCHEMA_VERSION}`
  }
  error = stringError(data.narrative_summary, 'single data.narrative_summary', 2000)
  if (error) return error
  error = validateArrayItems(data.anomalies, 'single data.anomalies', (item, label) => {
    const shape = objectError(item, label, ['tone', 'figure', 'text'])
    if (shape) return shape
    if (!new Set(['good', 'warn', 'bad', 'info']).has(item.tone)) return `${label}.tone is not recognized`
    return stringError(item.figure, `${label}.figure`, 80) || stringError(item.text, `${label}.text`, 1000)
  })
  return error ||
    validateArrayItems(data.eval_findings, 'single data.eval_findings', validateEvalFinding) ||
    validateArrayItems(data.observations, 'single data.observations', validateObservation) ||
    validateArrayItems(data.experiments, 'single data.experiments', validateExperiment) ||
    validateArrayItems(data.durable_candidates, 'single data.durable_candidates', validateCandidate)
}

function validateInsights(data) {
  const required = [
    'mode',
    'generated_at',
    'window',
    'coverage',
    'at_a_glance',
    'project_areas',
    'interaction_style',
    'wins',
    'frictions',
    'observations',
    'experiments',
    'durable_candidates',
    'evidence_limitations',
  ]
  let error = objectError(data, 'insights data', required)
  if (error) return error
  error = stringError(data.generated_at, 'insights data.generated_at', 80)
  if (error || !Number.isFinite(Date.parse(data.generated_at))) return error || 'insights data.generated_at must be ISO-8601'
  error = objectError(data.window, 'insights data.window', ['days', 'started_at', 'ended_at'])
  if (error) return error
  if (!Number.isInteger(data.window.days) || data.window.days <= 0) return 'insights data.window.days must be positive'
  for (const field of ['started_at', 'ended_at']) {
    if (typeof data.window[field] !== 'string' || !Number.isFinite(Date.parse(data.window[field]))) {
      return `insights data.window.${field} must be ISO-8601`
    }
  }
  error = validateCoverage(data.coverage, 'insights data.coverage')
  if (error) return error
  error = objectError(data.at_a_glance, 'insights data.at_a_glance', [
    'working', 'hindering', 'quick_wins', 'ambitious',
  ])
  if (error) return error
  for (const field of ['working', 'hindering', 'quick_wins', 'ambitious']) {
    error = stringError(data.at_a_glance[field], `insights data.at_a_glance.${field}`, 600)
    if (error) return error
  }
  error = stringError(data.interaction_style, 'insights data.interaction_style', 1200)
  if (error) return error
  const projectValidator = (item, label) => {
    const shape = objectError(item, label, ['area', 'text', 'evidence_refs'])
    return shape || stringError(item.area, `${label}.area`, 160) ||
      stringError(item.text, `${label}.text`, 1200) ||
      evidenceRefsError(item.evidence_refs, `${label}.evidence_refs`)
  }
  const winValidator = (item, label) => {
    const shape = objectError(item, label, ['title', 'text', 'evidence_refs'])
    return shape || stringError(item.title, `${label}.title`, 240) ||
      stringError(item.text, `${label}.text`, 1200) ||
      evidenceRefsError(item.evidence_refs, `${label}.evidence_refs`)
  }
  const frictionValidator = (item, label) => {
    const shape = objectError(item, label, ['title', 'owner', 'text', 'evidence_refs'])
    if (shape) return shape
    if (!new Set(['agent', 'user', 'environment']).has(item.owner)) return `${label}.owner is not recognized`
    return stringError(item.title, `${label}.title`, 240) ||
      stringError(item.text, `${label}.text`, 1200) ||
      evidenceRefsError(item.evidence_refs, `${label}.evidence_refs`)
  }
  error = validateArrayItems(data.project_areas, 'insights data.project_areas', projectValidator)
  return error ||
    validateArrayItems(data.wins, 'insights data.wins', winValidator) ||
    validateArrayItems(data.frictions, 'insights data.frictions', frictionValidator) ||
    validateArrayItems(data.observations, 'insights data.observations', validateObservation) ||
    validateArrayItems(data.experiments, 'insights data.experiments', validateExperiment) ||
    validateArrayItems(data.durable_candidates, 'insights data.durable_candidates', validateCandidate) ||
    (() => {
      const array = arrayError(data.evidence_limitations, 'insights data.evidence_limitations', 30)
      if (array) return array
      for (const [index, item] of data.evidence_limitations.entries()) {
        const itemError = stringError(item, `insights data.evidence_limitations[${index}]`, 1000)
        if (itemError) return itemError
      }
      return null
    })()
}

export function reportValidationError(mode, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'data must be a JSON object'
  if (data.mode !== mode) return `data.mode must equal ${mode}`
  return mode === 'single' ? validateSingle(data) : validateInsights(data)
}
