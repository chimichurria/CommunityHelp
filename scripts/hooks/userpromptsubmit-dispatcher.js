#!/usr/bin/env node
/**
 * UserPromptSubmit dispatcher — the AI-literacy coach's only entry point.
 *
 * WHY A PROMPT-TIME HOOK AT ALL. scripts/hooks/evaluate-session.js:9-13 records
 * a deliberate decision against UserPromptSubmit hooks: "Stop runs once at
 * session end (lightweight); UserPromptSubmit runs every message (heavy, adds
 * latency)". That objection is about TRANSCRIPT ANALYSIS every message. This
 * hook reads no transcript, spawns no process, opens no socket, and touches one
 * ~1.5 KB JSON file. The teaching moment it buys — correcting a prompt before
 * the turn is spent — does not exist anywhere else in the lifecycle.
 *
 * LATENCY, HONESTLY. Every ECC hook is two Node processes: the inline `node -e`
 * bootstrap plus a run-with-flags child (plugin-hook-bootstrap.js spawnNode).
 * That floor is ~55-65ms on macOS and is NOT this hook's doing; run-with-flags'
 * require() path saves the third spawn, not the second. What this file controls
 * is the marginal cost, budgeted at p50 ~3ms / p99 ~8ms, with a hard abort at
 * HARD_BUDGET_MS. Built as a dispatcher (mirroring pre-bash-dispatcher.js) so
 * the two-spawn toll is paid once no matter how many prompt-time rules get
 * added later. hooks/README.md publishes the measured number.
 *
 * FAIL-OPEN. Any throw, any malformed input, any unwritable state dir yields
 * empty stdout and exit 0, and the prompt passes through untouched. A coaching
 * note is never worth blocking someone's work.
 *
 * STDOUT IS CONTEXT. On UserPromptSubmit, plain stdout with exit 0 is injected
 * into the model's context. run-with-flags echoes raw stdin on its fail-open
 * paths, which would dump the whole hook payload into context on every prompt
 * where this hook is disabled or errors; isRawPassthrough() in
 * plugin-hook-bootstrap.js suppresses that. That suppression is load-bearing
 * for correctness here, not just transcript hygiene — see
 * tests/hooks/coach-passthrough-suppression.test.js.
 */

'use strict';

const path = require('path');

const HARD_BUDGET_MS = 15;
const HOOK_EVENT = 'UserPromptSubmit';

function nothing() {
  return { hookEventName: HOOK_EVENT, exitCode: 0 };
}

function isEnabled(env) {
  const raw = env.ECC_COACH_ENABLED;
  if (raw === undefined || String(raw).trim() === '') return true;
  return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

function isForced(env) {
  return ['1', 'true', 'yes', 'on'].includes(String(env.ECC_COACH_ALWAYS || '').trim().toLowerCase());
}

function loadHints(pluginRoot) {
  try {
    const hints = require(path.join(pluginRoot, 'scripts', 'lib', 'coach', 'component-hints.json'));
    const copy = { ...hints };
    delete copy.__comment;
    return copy;
  } catch {
    return null;
  }
}

/**
 * @param {string} raw stdin payload
 * @param {{hookId?: string, pluginRoot?: string, truncated?: boolean}} [ctx]
 */
function run(raw, ctx = {}) {
  const env = process.env;
  if (!isEnabled(env)) return nothing();

  // A >1MB prompt is not a teaching moment, and the payload is unparseable anyway.
  if (ctx.truncated) return nothing();

  let prompt;
  try {
    const payload = JSON.parse(raw);
    prompt = payload && (payload.prompt || payload.user_prompt);
  } catch {
    return nothing();
  }
  if (typeof prompt !== 'string' || prompt.trim().length === 0) return nothing();

  const started = process.hrtime.bigint();
  const elapsedMs = () => Number(process.hrtime.bigint() - started) / 1e6;

  try {
    const pluginRoot = ctx.pluginRoot || path.resolve(__dirname, '..', '..');
    const libDir = path.join(pluginRoot, 'scripts', 'lib', 'coach');
    const { extractFeatures } = require(path.join(libDir, 'features.js'));
    const { readCoachState, writeCoachState, appendCoachEvent, nowSeconds } = require(path.join(libDir, 'state.js'));
    const { selectRule, applyOutcome } = require(path.join(libDir, 'cadence.js'));
    const { renderNote, readIdentityHints } = require(path.join(libDir, 'note.js'));
    const { RULES_BY_ID } = require(path.join(libDir, 'rules.js'));

    const features = extractFeatures(prompt, { hints: loadHints(pluginRoot) });

    // Slow disk or a pathological prompt must not tax the user: bail before
    // doing any I/O, leaving state untouched.
    if (elapsedMs() > HARD_BUDGET_MS) return nothing();

    const state = readCoachState();
    const forced = isForced(env);
    const now = nowSeconds();
    const { rule, applicable, matching } = selectRule(features, state, { now, forced });

    const nextState = applyOutcome(state, {
      features,
      applicable,
      matching,
      firedRuleId: rule ? rule.id : null,
      forced,
      now,
    });

    try {
      writeCoachState(nextState);
    } catch {
      // An unwritable state dir degrades the cadence, never the prompt.
    }

    if (!rule) return nothing();

    const note = renderNote(RULES_BY_ID[rule.id] || rule, features, {
      identity: readIdentityHints({ cwd: process.cwd() }),
    });
    if (!note) return nothing();

    if (!forced) {
      appendCoachEvent({
        ruleId: rule.id,
        lang: features.lang,
        lenBucket: features.lenBucket,
        firedAt: now,
        promptIndex: nextState.promptsSeen,
      });
    }

    return { hookEventName: HOOK_EVENT, additionalContext: note, exitCode: 0 };
  } catch {
    return nothing();
  }
}

module.exports = { run, HARD_BUDGET_MS, HOOK_EVENT };

// Standalone invocation (manual testing, and the documented smoke check):
//   echo '{"prompt":"..."}' | node scripts/hooks/userpromptsubmit-dispatcher.js
if (require.main === module) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => {
    buf += c;
  });
  process.stdin.on('end', () => {
    const result = run(buf, {});
    if (result.additionalContext) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: result.hookEventName,
          additionalContext: result.additionalContext,
        },
      }));
    }
    process.exit(0);
  });
  process.stdin.on('error', () => process.exit(0));
}
