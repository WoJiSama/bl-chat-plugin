// utils/memory/entityModel.js
import { clamp, compactText } from './constants.js'

function uniqStrings(values = []) {
  return [...new Set((values || [])
    .filter(v => v !== undefined && v !== null && String(v).trim() !== '')
    .map(String))]
}

export function makeAlias(input = {}) {
  return {
    text: compactText(input.text, 64),
    authority: input.authority || 'mention',
    confidence: clamp(input.confidence ?? 0.7),
    by: uniqStrings(input.by),
    at: Number(input.at) || 0,
    superseded: input.superseded === true
  }
}

export function makeFact(input = {}) {
  return {
    text: compactText(input.text, 240),
    tags: uniqStrings(input.tags),
    refs: uniqStrings(input.refs),
    authority: input.authority || 'mention',
    confidence: clamp(input.confidence ?? 0.7),
    at: Number(input.at) || 0,
    superseded: input.superseded === true
  }
}

export function makeEntity(input = {}) {
  return {
    qq: input.qq === undefined || input.qq === null || input.qq === '' ? null : String(input.qq),
    canonicalName: compactText(input.canonicalName, 64) || null,
    aliases: Array.isArray(input.aliases) ? input.aliases.map(makeAlias) : [],
    facts: Array.isArray(input.facts) ? input.facts.map(makeFact) : [],
    updatedAt: Number(input.updatedAt) || 0
  }
}

export function slimEntityDoc(doc = {}) {
  const out = {}
  for (const [id, entity] of Object.entries(doc || {})) {
    out[id] = makeEntity(entity)
  }
  return out
}

export function slimGroupFacts(facts = []) {
  return (Array.isArray(facts) ? facts : []).map(makeFact)
}
