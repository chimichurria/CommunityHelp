#!/usr/bin/env node
/**
 * Persistent state for the AI-literacy coach.
 *
 * PRIVACY CONTRACT — this is the only file the coach writes on the hot path,
 * and it is the enforcement point, not a promise:
 *
 *   sanitizeState() rebuilds the document field by field from a whitelist and
 *   is called INSIDE writeCoachState(), so it cannot be skipped. Top-level keys
 *   come from a literal list; rule keys must be in RULE_IDS (frozen at load);
 *   every number must pass Number.isInteger and is clamped; `updatedAt` is
 *   regenerated rather than copied from input. There is no serializable
 *   free-text field anywhere in the writer, so a future contributor who tries
 *   to stash a prompt snippet here cannot.
 *
 * NEVER written: prompt text or any substring of it, character counts finer
 * than the five buckets, file paths, cwd, repo name, git remote, session id,
 * transcript path, tool names, model name, username, hostname.
 *
 * The precedent followed here is scripts/hooks/skill-run-tracker.js, which
 * synthesizes its descriptions and charset-bounds every string. It is NOT
 * scripts/lib/skill-evolution/tracker.js, which requires a free-text
 * task_description and passes failure_reason through unvalidated — coach data
 * must never be routed through that path.
 *
 * Shape is a JSON object rather than an append log because this is a
 * read-modify-write of small counters on every prompt; an append log would grow
 * parse cost linearly forever. Size is structurally bounded: 8 rule entries
 * plus a fixed header, and sanitize drops everything else.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeFileAtomic } = require('../atomic-write');
const { RULE_IDS, RULE_VERSION } = require('./rules');
const { LEN_BUCKETS } = require('./features');

const COACH_STATE_VERSION = 'ecc.coach-state.v1';
const COACH_EVENT_VERSION = 'ecc.coach-event.v1';
const FILE_MODE = 0o600;
const MAX_COUNTER = 1e9;
const MAX_FIRED_AT = 3;           // G1 only needs the last few fires
const FIRED_AT_WINDOW_SEC = 3600; // one hour
const MAX_COACH_EVENTS = 2000;
const STATUSES = Object.freeze(['active', 'graduated']);
const LANGS = Object.freeze(['en', 'es']);

function stateDir(options = {}) {
  const env = options.env || process.env;
  const home = env.HOME || os.homedir();
  return path.join(home, '.claude', 'state');
}

function getCoachStatePath(options = {}) {
  const env = options.env || process.env;
  const override = String(env.ECC_COACH_STATE_PATH || '').trim();
  if (override && path.isAbsolute(override)) return override;
  return path.join(stateDir(options), 'coach-state.json');
}

function getCoachEventsPath(options = {}) {
  const env = options.env || process.env;
  const override = String(env.ECC_COACH_EVENTS_PATH || '').trim();
  if (override && path.isAbsolute(override)) return override;
  return path.join(stateDir(options), 'coach-events.jsonl');
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function isoNoMillis() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function defaultRuleEntry() {
  return { seen: 0, fired: 0, cleanStreak: 0, relapseHits: 0, lastFiredPrompt: 0, status: 'active' };
}

function defaultState() {
  const rules = {};
  for (const id of RULE_IDS) rules[id] = defaultRuleEntry();
  const lenBuckets = {};
  for (const b of LEN_BUCKETS) lenBuckets[b] = 0;
  const lang = {};
  for (const l of LANGS) lang[l] = 0;
  return {
    schema: COACH_STATE_VERSION,
    ruleVersion: RULE_VERSION,
    updatedAt: isoNoMillis(),
    promptsSeen: 0,
    firedAt: [],
    lenBuckets,
    lang,
    rules,
  };
}

/** Coerce to a bounded non-negative integer, or 0. */
function counter(value) {
  if (!Number.isInteger(value) || value < 0) return 0;
  return value > MAX_COUNTER ? MAX_COUNTER : value;
}

/**
 * THE privacy gate. Rebuilds the document from a whitelist; anything not
 * explicitly named here is dropped. Always called inside writeCoachState.
 */
function sanitizeState(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = defaultState();

  out.promptsSeen = counter(src.promptsSeen);

  if (Array.isArray(src.firedAt)) {
    const cutoff = nowSeconds() - FIRED_AT_WINDOW_SEC;
    out.firedAt = src.firedAt
      .filter(t => Number.isInteger(t) && t > cutoff && t <= nowSeconds() + 60)
      .slice(-MAX_FIRED_AT);
  }

  if (src.lenBuckets && typeof src.lenBuckets === 'object') {
    for (const b of LEN_BUCKETS) out.lenBuckets[b] = counter(src.lenBuckets[b]);
  }

  if (src.lang && typeof src.lang === 'object') {
    for (const l of LANGS) out.lang[l] = counter(src.lang[l]);
  }

  if (src.rules && typeof src.rules === 'object') {
    for (const id of RULE_IDS) {
      const r = src.rules[id];
      if (!r || typeof r !== 'object') continue;
      out.rules[id] = {
        seen: counter(r.seen),
        fired: counter(r.fired),
        cleanStreak: counter(r.cleanStreak),
        relapseHits: counter(r.relapseHits),
        lastFiredPrompt: counter(r.lastFiredPrompt),
        status: STATUSES.includes(r.status) ? r.status : 'active',
      };
    }
  }

  // Regenerated, never copied: a caller-supplied timestamp is free text.
  out.updatedAt = isoNoMillis();
  return out;
}

/** Returns a fresh default state on any error — a corrupt file is not fatal. */
function readCoachState(options = {}) {
  try {
    const raw = fs.readFileSync(getCoachStatePath(options), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultState();
    // A state written by a different rule generation is not comparable.
    if (parsed.ruleVersion !== RULE_VERSION) return defaultState();
    return sanitizeState(parsed);
  } catch {
    return defaultState();
  }
}

function writeCoachState(state, options = {}) {
  const clean = sanitizeState(state);
  const target = getCoachStatePath(options);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeFileAtomic(target, `${JSON.stringify(clean, null, 2)}\n`, { mode: FILE_MODE });
  return clean;
}

/**
 * Second sink, written ONLY when a note actually fires (at most 3/hour), so it
 * costs nothing on the common path. Without it we cannot answer "which rules
 * never fire", which is the entire input to the improvement loop.
 *
 * Same whitelist discipline: rule id from RULE_IDS, lang and bucket from frozen
 * sets, everything else an integer.
 */
function appendCoachEvent(event, options = {}) {
  const ruleId = RULE_IDS.includes(event && event.ruleId) ? event.ruleId : null;
  if (!ruleId) return false;

  const record = {
    schema: COACH_EVENT_VERSION,
    ruleId,
    lang: LANGS.includes(event.lang) ? event.lang : 'en',
    lenBucket: LEN_BUCKETS.includes(event.lenBucket) ? event.lenBucket : 'm',
    firedAt: Number.isInteger(event.firedAt) ? event.firedAt : nowSeconds(),
    promptIndex: counter(event.promptIndex),
  };

  const target = getCoachEventsPath(options);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${JSON.stringify(record)}\n`, { mode: FILE_MODE });
    try {
      fs.chmodSync(target, FILE_MODE);
    } catch {
      // best effort: a pre-existing file with looser mode is still ours to use
    }
    pruneCoachEvents(target);
    return true;
  } catch {
    return false;
  }
}

function pruneCoachEvents(target) {
  try {
    const lines = fs.readFileSync(target, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= MAX_COACH_EVENTS) return;
    const kept = lines.slice(-MAX_COACH_EVENTS).join('\n');
    writeFileAtomic(target, `${kept}\n`, { mode: FILE_MODE });
  } catch {
    // pruning is best-effort; a failure must never break the hook
  }
}

function readCoachEvents(options = {}) {
  try {
    return fs
      .readFileSync(getCoachEventsPath(options), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = {
  COACH_STATE_VERSION,
  COACH_EVENT_VERSION,
  FILE_MODE,
  MAX_COACH_EVENTS,
  defaultState,
  sanitizeState,
  readCoachState,
  writeCoachState,
  appendCoachEvent,
  readCoachEvents,
  getCoachStatePath,
  getCoachEventsPath,
  nowSeconds,
};
