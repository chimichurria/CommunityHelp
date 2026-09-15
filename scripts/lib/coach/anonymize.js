#!/usr/bin/env node
/**
 * Build and verify the only payload that ever leaves the machine.
 *
 * Design stance: the check runs on the SERIALIZED string, not on a walk of the
 * object graph. An object walk only inspects the shapes you thought to look
 * for; a string scan catches anything that made it into the JSON, including
 * whatever a future contributor nests three levels down in a field nobody
 * reviewed.
 *
 * assertAnonymous() THROWS rather than sanitizing. A payload containing a
 * hostname is not a payload to be cleaned and sent -- it is evidence that
 * something upstream is collecting more than the design allows, and that is
 * worth stopping to understand.
 */

'use strict';

const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { RULE_IDS, RULE_VERSION, RULES_BY_ID } = require('./rules');

const CONTRIBUTION_SCHEMA = 'ecc.coach-contribution.v1';
const MAX_AUTHORED_LEN = 600;

// Reused verbatim from scripts/ci/validate-no-personal-paths.js so the two
// cannot drift into disagreeing about what a personal path looks like.
const POSIX_USER_RE = /\/Users\/([a-zA-Z][a-zA-Z0-9._-]*)/g;
const WIN_USER_RE = /C:\\Users\\([a-zA-Z][a-zA-Z0-9._-]*)/gi;

// Invisible and formatting codepoints: a user-pasted note is exactly the vector
// check-unicode-safety.js exists to stop, and this payload is headed for a
// public repository where a maintainer will read it.
const INVISIBLE_RE = /[\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2064\u206a-\u206f\ufeff\ufff9-\ufffb]|[\udb40][\udc00-\udcff]/;

function safeGitRemote() {
  try {
    return execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
    }).trim();
  } catch {
    return '';
  }
}

/**
 * @param {object} proposal output of scripts/coach-evolve.js --json
 * @param {{authored?: Record<string, {en?: string, es?: string}>}} [options]
 *        Notes the USER typed during confirmation. This is the only legitimate
 *        path for free text into the payload, and it enters with them looking
 *        at it.
 */
function buildContributionPayload(proposal, options = {}) {
  const authored = options.authored || {};
  const items = [];

  for (const item of (proposal.items || [])) {
    if (!RULE_IDS.includes(item.ruleId)) continue;
    const rule = RULES_BY_ID[item.ruleId];
    const entry = {
      kind: ['rule-retire', 'rule-amendment', 'rule-proposal'].includes(item.kind) ? item.kind : 'rule-amendment',
      ruleId: item.ruleId,
      topic: rule ? rule.topic : 'unknown',
      counts: {
        seen: Number(item.counts && item.counts.seen) || 0,
        fired: Number(item.counts && item.counts.fired) || 0,
        cleanStreakMax: Number(item.counts && item.counts.cleanStreakMax) || 0,
        relapseHits: Number(item.counts && item.counts.relapseHits) || 0,
      },
    };
    const note = authored[item.ruleId];
    if (note && (note.en || note.es)) {
      entry.authoredNote = {
        en: String(note.en || '').slice(0, MAX_AUTHORED_LEN),
        es: String(note.es || '').slice(0, MAX_AUTHORED_LEN),
      };
    }
    items.push(entry);
  }

  return {
    schema: CONTRIBUTION_SCHEMA,
    ruleVersion: RULE_VERSION,
    day: String(proposal.day || new Date().toISOString().slice(0, 10)).slice(0, 10),
    items,
  };
}

/**
 * Throws with the offending needle named. Returns nothing on success.
 * @param {object|string} payload
 */
function assertAnonymous(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  // JSON.stringify doubles backslashes, so a Windows path serializes as
  // `C:\\Users\\name` and a single-backslash pattern misses it. Scan both forms.
  const unescaped = text.replace(/\\\\/g, '\\');
  const scan = pattern => {
    pattern.lastIndex = 0;
    const a = pattern.test(text);
    pattern.lastIndex = 0;
    const b = pattern.test(unescaped);
    pattern.lastIndex = 0;
    return a || b;
  };

  const home = os.homedir();
  const hostname = os.hostname();
  let username = '';
  try {
    username = os.userInfo().username;
  } catch {
    username = '';
  }
  const cwd = process.cwd();
  const cwdName = path.basename(cwd);
  const remote = safeGitRemote();

  // Absolute paths and hostnames are unambiguous: a bare substring match is safe.
  for (const [label, needle] of [
    ['home directory', home],
    ['hostname', hostname],
    ['git remote', remote],
    ['working directory path', cwd],
  ]) {
    if (!needle || needle.length < 4) continue;
    if (text.includes(needle)) {
      throw new Error(`Refusing to send: payload contains the ${label} (${JSON.stringify(needle)}).`);
    }
  }

  // A bare directory or user NAME is not a leak -- a path containing it is.
  // Checking the bare word would false-positive on any project called "ecc",
  // "app", or "web", including inside our own schema strings, which would make
  // this gate useless exactly where it matters.
  for (const [label, name] of [['working directory name', cwdName], ['username', username]]) {
    if (!name || name.length < 2) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const asPathSegment = new RegExp(`[/\\\\]${escaped}(?=[/\\\\]|\\b)`);
    if (asPathSegment.test(text) || asPathSegment.test(unescaped)) {
      throw new Error(`Refusing to send: payload contains a path naming the ${label} (${JSON.stringify(name)}).`);
    }
  }

  if (scan(POSIX_USER_RE) || scan(WIN_USER_RE)) {
    throw new Error('Refusing to send: payload contains a personal filesystem path.');
  }

  // Sub-day timestamps are finer than the design permits.
  if (/\d{2}:\d{2}:\d{2}/.test(text)) {
    throw new Error('Refusing to send: payload contains a timestamp finer than the day.');
  }

  // Credential shapes, using the vault's existing scanner where available.
  try {
    const { findPotentialSecrets } = require('../memory-vault-format');
    const hits = findPotentialSecrets(text);
    if (Array.isArray(hits) && hits.length > 0) {
      throw new Error(`Refusing to send: payload looks like it contains a credential (${hits[0]}).`);
    }
  } catch (error) {
    if (/Refusing to send/.test(error.message)) throw error;
    // Scanner unavailable: fall through to the local pattern below.
  }
  if (/\b(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,})\b/.test(text)) {
    throw new Error('Refusing to send: payload contains a credential-shaped value.');
  }

  if (INVISIBLE_RE.test(text)) {
    throw new Error('Refusing to send: payload contains invisible or formatting codepoints.');
  }

  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (parsed.schema !== CONTRIBUTION_SCHEMA) {
    throw new Error(`Refusing to send: unexpected schema ${JSON.stringify(parsed.schema)}.`);
  }
  const allowedTop = new Set(['schema', 'ruleVersion', 'day', 'items']);
  for (const key of Object.keys(parsed)) {
    if (!allowedTop.has(key)) {
      throw new Error(`Refusing to send: unexpected top-level field ${JSON.stringify(key)}.`);
    }
  }
  const allowedItem = new Set(['kind', 'ruleId', 'topic', 'counts', 'authoredNote', 'authoredMatcher']);
  for (const item of parsed.items || []) {
    for (const key of Object.keys(item)) {
      if (!allowedItem.has(key)) {
        throw new Error(`Refusing to send: unexpected item field ${JSON.stringify(key)}.`);
      }
    }
  }
}

module.exports = { buildContributionPayload, assertAnonymous, CONTRIBUTION_SCHEMA, MAX_AUTHORED_LEN };
