#!/usr/bin/env node
/**
 * Renders a coaching note.
 *
 * Both lengths of every note are pre-written in rules.js — nothing is generated
 * here. The only runtime choice is language, length, and placeholder fill, all
 * of which are bounded string operations.
 *
 * Verbosity comes from .claude/identity.json, which upstream populated but
 * never read. Reading it here gives that file a real consumer without turning
 * a git-tracked repo file into mutable per-user state: this module NEVER
 * writes it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VERBOSITIES = Object.freeze(['minimal', 'normal', 'detailed']);
const MAX_COMPONENT_LEN = 60;
const RE_SAFE_COMPONENT = /^[a-z0-9][a-z0-9._-]*$/i;

let identityCache = null;
let identityCacheKey = null;

/**
 * Best-effort read of <cwd>/.claude/identity.json. Never throws, never writes.
 * Cached per cwd — a hook process is single-use, so this is one read per prompt.
 */
function readIdentityHints(options = {}) {
  const cwd = options.cwd || process.cwd();
  if (identityCacheKey === cwd && identityCache) return identityCache;

  let verbosity = 'normal';
  try {
    const raw = fs.readFileSync(path.join(cwd, '.claude', 'identity.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const v = parsed && parsed.preferredStyle && parsed.preferredStyle.verbosity;
    if (VERBOSITIES.includes(v)) verbosity = v;
  } catch {
    // absent, unreadable, or malformed: 'normal' is the right default
  }

  identityCache = { verbosity };
  identityCacheKey = cwd;
  return identityCache;
}

function fillPlaceholders(text, features) {
  if (!text.includes('{')) return text;
  const hint = features && features.skillHint;
  const component = hint && RE_SAFE_COMPONENT.test(String(hint.component || ''))
    ? String(hint.component).slice(0, MAX_COMPONENT_LEN)
    : 'a matching skill';
  const kind = hint && ['skill', 'agent', 'command'].includes(hint.kind) ? hint.kind : 'skill';
  return text.replace(/\{component\}/g, component).replace(/\{kind\}/g, kind);
}

/**
 * @returns {string} the note text, or '' when nothing should be shown.
 */
function renderNote(rule, features, options = {}) {
  if (!rule || !rule.note) return '';
  const lang = features && features.lang === 'es' ? 'es' : 'en';
  const variants = rule.note[lang] || rule.note.en;
  if (!variants) return '';

  const verbosity = (options.identity && options.identity.verbosity) || 'normal';
  const body = verbosity === 'minimal' ? variants.short : variants.long;
  if (!body) return '';

  const filled = fillPlaceholders(body, features);
  const label = lang === 'es' ? 'Nota de prompting' : 'Prompting note';
  const muteHint = lang === 'es'
    ? 'Silenciar: /coach-mute ' + rule.id
    : 'Silence: /coach-mute ' + rule.id;

  return `[${label}: ${rule.id}] ${filled}\n(${muteHint})`;
}

module.exports = { renderNote, readIdentityHints, VERBOSITIES };
