/**
 * The improvement loop's analysis, and its hard constraint: it must never write
 * outside its own state directory, and never emit prompt-derived content.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { analyze, buildProposal } = require('../../scripts/coach-evolve');
const { deriveProfile } = require('../../scripts/coach-status');
const { defaultState } = require('../../scripts/lib/coach/state');

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

console.log('\n=== Testing coach evolution analysis ===\n');

test('detects a dead rule: applicable often, never fired', () => {
  const state = defaultState();
  state.promptsSeen = 200;
  state.rules['no-test-mention'].seen = 120;
  state.rules['no-test-mention'].fired = 0;

  const items = analyze(state, []);
  const dead = items.find(i => i.ruleId === 'no-test-mention' && i.kind === 'rule-retire');
  assert.ok(dead, 'a rule applicable 120 times that never fired should be flagged');
  assert.ok(/latency/i.test(dead.reason), 'the reason should explain the actual cost');
});

test('does not flag a rule with too little evidence', () => {
  const state = defaultState();
  state.rules['no-test-mention'].seen = 10;
  state.rules['no-test-mention'].fired = 0;
  assert.strictEqual(analyze(state, []).length, 0, 'ten prompts is not evidence');
});

test('detects an inert note: fired often, never produced a clean streak', () => {
  const state = defaultState();
  state.promptsSeen = 200;
  state.rules['vague-scope'].seen = 60;
  state.rules['vague-scope'].fired = 9;
  state.rules['vague-scope'].cleanStreak = 1;

  const items = analyze(state, []);
  const inert = items.find(i => i.ruleId === 'vague-scope' && i.kind === 'rule-amendment');
  assert.ok(inert, 'a note shown nine times that never changed behavior should be flagged');
});

test('does not flag a note that is working', () => {
  const state = defaultState();
  state.promptsSeen = 200;
  state.rules['vague-scope'].seen = 60;
  state.rules['vague-scope'].fired = 9;
  state.rules['vague-scope'].cleanStreak = 6; // behavior changed
  const items = analyze(state, []).filter(i => i.ruleId === 'vague-scope');
  assert.strictEqual(items.length, 0, 'a note that produced a clean streak is landing');
});

test('a graduated rule is not reported as inert', () => {
  const state = defaultState();
  state.promptsSeen = 200;
  state.rules['vague-scope'].seen = 60;
  state.rules['vague-scope'].fired = 9;
  state.rules['vague-scope'].cleanStreak = 0;
  state.rules['vague-scope'].status = 'graduated';
  assert.strictEqual(analyze(state, []).filter(i => i.ruleId === 'vague-scope').length, 0);
});

test('proposal carries no prompt-derived content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-evolve-'));
  const prev = process.env.HOME;
  process.env.HOME = dir;
  try {
    const json = JSON.stringify(buildProposal());
    // Nothing finer than the day, and no free text beyond our own fixed reasons.
    assert.ok(!/\d{2}:\d{2}:\d{2}/.test(json), 'proposal must not carry sub-day timestamps');
    assert.ok(!json.includes(dir), 'proposal must not carry filesystem paths');
    assert.ok(!json.includes(os.hostname()), 'proposal must not carry the hostname');
  } finally {
    process.env.HOME = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reporting writes nothing outside the state directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-evolve-'));
  const repoRoot = path.join(__dirname, '..', '..');
  const before = fs.readdirSync(repoRoot).sort().join('|');
  const prev = process.env.HOME;
  process.env.HOME = dir;
  try {
    buildProposal();
  } finally {
    process.env.HOME = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.strictEqual(fs.readdirSync(repoRoot).sort().join('|'), before,
    'analysis must not create files in the repository');
});

test('profile is a pure projection: same state always yields the same levels', () => {
  const state = defaultState();
  state.promptsSeen = 50;
  state.rules['no-test-mention'].status = 'graduated';
  state.rules['no-test-mention'].seen = 20;
  const a = deriveProfile(state);
  const b = deriveProfile(state);
  assert.deepStrictEqual(a.topics, b.topics, 'derivation must be deterministic');
  assert.strictEqual(a.topics.verification.level, 4, 'the only verification rule graduated');
});

test('profile levels rise only through graduation', () => {
  const state = defaultState();
  state.promptsSeen = 50;
  state.rules['vague-scope'].seen = 40; // lots of evidence, no graduation
  const profile = deriveProfile(state);
  assert.strictEqual(profile.topics.scoping.level, 1,
    'evidence alone floors the level at 1; it does not raise it');
});

// --- CLI surface -----------------------------------------------------------
// Covered as a CLI because `npm run coverage` uses c8 --all over scripts/**:
// rendering and argument handling count even when the analysis is tested.

const { spawnSync } = require('child_process');
const EVOLVE = path.join(__dirname, '..', '..', 'scripts', 'coach-evolve.js');

function runCli(args = []) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-evolve-cli-'));
  try {
    return spawnSync(process.execPath, [EVOLVE, ...args], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('--report renders without crashing on an empty history', () => {
  const r = runCli(['--report']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('Coach evolution report'));
});

test('--report says so when there is not enough history to judge', () => {
  const r = runCli(['--report']);
  assert.ok(/Not enough history/i.test(r.stdout),
    'a report built on no data should say so rather than read as findings');
});

test('--report states plainly that it applies nothing', () => {
  const r = runCli(['--report']);
  assert.ok(/applies nothing/i.test(r.stdout),
    'the propose-only contract must be visible to the person reading the report');
});

test('--json emits a schema-tagged proposal', () => {
  const r = runCli(['--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const proposal = JSON.parse(r.stdout);
  assert.strictEqual(proposal.schema, 'ecc.coach-evolution-proposal.v1');
  assert.ok(Array.isArray(proposal.items));
  assert.match(proposal.day, /^\d{4}-\d{2}-\d{2}$/, 'day must be no finer than a date');
});

test('the default invocation renders the report', () => {
  const r = runCli([]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('Coach evolution report'));
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
