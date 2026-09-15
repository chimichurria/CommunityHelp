/**
 * The cadence gates. These thresholds are the difference between a coach people
 * keep and a coach people disable, so each gate is pinned exactly -- including
 * the boundary, since "roughly 12" is not a contract.
 */

'use strict';

const assert = require('assert');

const { selectRule, applyOutcome, GLOBAL_MIN_GAP_PROMPTS, GLOBAL_MAX_PER_HOUR,
        RULE_COOLDOWN_PROMPTS, GRADUATE_STREAK, RELAPSE_MATCHES } = require('../../scripts/lib/coach/cadence');
const { defaultState } = require('../../scripts/lib/coach/state');
const { extractFeatures } = require('../../scripts/lib/coach/features');
const { RULE_IDS } = require('../../scripts/lib/coach/rules');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
    failed += 1;
  }
}

const NOW = 1_700_000_000;
const vague = () => extractFeatures('arregla todo el codigo del proyecto');
// Applicable to no-test-mention but clean for it: anchored, has criteria, has tests.
const clean = () => extractFeatures('add a retry in `src/api/client.ts`; done when the existing test passes and coverage is unchanged');

console.log('\n=== Testing coach cadence gates ===\n');

test('G0: at most one rule fires per prompt', () => {
  const { rule } = selectRule(vague(), defaultState(), { now: NOW });
  assert.ok(rule, 'expected a rule to fire on a vague prompt');
  assert.strictEqual(typeof rule.id, 'string');
});

test(`G1: no second note within ${GLOBAL_MIN_GAP_PROMPTS} prompts`, () => {
  let state = defaultState();
  const first = selectRule(vague(), state, { now: NOW });
  state = applyOutcome(state, { features: vague(), applicable: first.applicable, matching: first.matching, firedRuleId: first.rule.id, now: NOW });

  // Immediately after firing, the gap gate suppresses.
  const second = selectRule(vague(), state, { now: NOW });
  assert.strictEqual(second.rule, null);
  assert.strictEqual(second.reason, 'g1-min-gap');
});

test(`G1: at most ${GLOBAL_MAX_PER_HOUR} notes per hour`, () => {
  const state = defaultState();
  state.firedAt = [NOW - 10, NOW - 20, NOW - 30];
  state.promptsSeen = 100; // far past any min-gap
  const result = selectRule(vague(), state, { now: NOW });
  assert.strictEqual(result.rule, null);
  assert.strictEqual(result.reason, 'g1-hourly-cap');
});

test(`G1: fires older than an hour do not count`, () => {
  const state = defaultState();
  state.firedAt = [NOW - 3601, NOW - 4000, NOW - 5000];
  state.promptsSeen = 100;
  const result = selectRule(vague(), state, { now: NOW });
  assert.ok(result.rule, 'stale fires should not hold the hourly cap');
});

test(`G2: per-rule cooldown is exactly ${RULE_COOLDOWN_PROMPTS} prompts`, () => {
  const build = gap => {
    const state = defaultState();
    state.promptsSeen = 100;
    for (const id of RULE_IDS) state.rules[id].status = 'graduated';
    state.rules['vague-scope'].status = 'active';
    state.rules['vague-scope'].lastFiredPrompt = 101 - gap;
    return state;
  };
  // One short of the cooldown: suppressed.
  assert.strictEqual(selectRule(vague(), build(RULE_COOLDOWN_PROMPTS - 1), { now: NOW }).rule, null);
  // Exactly at the cooldown: allowed.
  const at = selectRule(vague(), build(RULE_COOLDOWN_PROMPTS), { now: NOW });
  assert.ok(at.rule, `expected a fire at exactly ${RULE_COOLDOWN_PROMPTS} prompts`);
});

test(`G3: graduates after exactly ${GRADUATE_STREAK} clean APPLICABLE prompts`, () => {
  let state = defaultState();
  const f = clean();
  for (let i = 0; i < GRADUATE_STREAK - 1; i += 1) {
    const sel = selectRule(f, state, { now: NOW });
    state = applyOutcome(state, { features: f, applicable: sel.applicable, matching: sel.matching, firedRuleId: null, now: NOW });
  }
  assert.strictEqual(state.rules['no-test-mention'].status, 'active', 'must not graduate early');

  const sel = selectRule(f, state, { now: NOW });
  state = applyOutcome(state, { features: f, applicable: sel.applicable, matching: sel.matching, firedRuleId: null, now: NOW });
  assert.strictEqual(state.rules['no-test-mention'].status, 'graduated');
});

test('G3: non-applicable prompts do NOT graduate a rule', () => {
  // A question is not a task request, so no-test-mention never applies to it.
  const question = extractFeatures('What does this file do?');
  let state = defaultState();
  for (let i = 0; i < GRADUATE_STREAK * 2; i += 1) {
    const sel = selectRule(question, state, { now: NOW });
    state = applyOutcome(state, { features: question, applicable: sel.applicable, matching: sel.matching, firedRuleId: null, now: NOW });
  }
  assert.strictEqual(state.rules['no-test-mention'].status, 'active',
    'irrelevant prompts must not be credited as mastery');
  assert.strictEqual(state.rules['no-test-mention'].seen, 0);
});

test(`G4: relapses back to active after ${RELAPSE_MATCHES} post-graduation matches`, () => {
  let state = defaultState();
  state.rules['vague-scope'].status = 'graduated';
  const f = vague();
  for (let i = 0; i < RELAPSE_MATCHES - 1; i += 1) {
    const sel = selectRule(f, state, { now: NOW });
    state = applyOutcome(state, { features: f, applicable: sel.applicable, matching: sel.matching, firedRuleId: null, now: NOW });
  }
  assert.strictEqual(state.rules['vague-scope'].status, 'graduated', 'must not relapse early');

  const sel = selectRule(f, state, { now: NOW });
  state = applyOutcome(state, { features: f, applicable: sel.applicable, matching: sel.matching, firedRuleId: null, now: NOW });
  assert.strictEqual(state.rules['vague-scope'].status, 'active');
  assert.strictEqual(state.rules['vague-scope'].relapseHits, 0, 'relapse counter resets on reactivation');
});

test('tiebreak: least-fired rule wins (teach breadth before depth)', () => {
  const state = defaultState();
  state.promptsSeen = 100;
  state.rules['vague-scope'].fired = 6;
  state.rules['no-file-anchors'].fired = 0;
  const { rule } = selectRule(vague(), state, { now: NOW });
  assert.notStrictEqual(rule.id, 'vague-scope', 'a heavily-fired rule should yield to a novel one');
});

test('tiebreak is deterministic across repeated calls', () => {
  const state = defaultState();
  state.promptsSeen = 100;
  const ids = new Set();
  for (let i = 0; i < 20; i += 1) ids.add(selectRule(vague(), state, { now: NOW }).rule.id);
  assert.strictEqual(ids.size, 1, `selection was non-deterministic: ${[...ids].join(', ')}`);
});

test('ECC_COACH_ALWAYS bypasses the gates but does not spend the real budget', () => {
  const state = defaultState();
  state.firedAt = [NOW - 1, NOW - 2, NOW - 3]; // hourly cap already reached
  state.promptsSeen = 100;

  const forced = selectRule(vague(), state, { now: NOW, forced: true });
  assert.ok(forced.rule, 'forced mode must bypass the hourly cap');

  const next = applyOutcome(state, {
    features: vague(), applicable: forced.applicable, matching: forced.matching,
    firedRuleId: forced.rule.id, forced: true, now: NOW,
  });
  assert.deepStrictEqual(next.firedAt, state.firedAt, 'forced fire must not consume the rate limit');
  assert.strictEqual(next.rules[forced.rule.id].fired, state.rules[forced.rule.id].fired,
    'forced fire must not distort the learner profile');
});

test('a broken rule predicate cannot break selection', () => {
  const brokenFeatures = new Proxy({}, { get() { throw new Error('boom'); } });
  const result = selectRule(brokenFeatures, defaultState(), { now: NOW });
  assert.strictEqual(result.rule, null);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
