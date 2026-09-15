/**
 * The gate on the only outbound path. Every case below is a thing that must
 * never reach a public pull request, and the check must THROW rather than
 * quietly strip it -- a payload carrying a hostname means something upstream
 * is collecting more than the design allows.
 */

'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');

const { buildContributionPayload, assertAnonymous, CONTRIBUTION_SCHEMA } = require('../../scripts/lib/coach/anonymize');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    ${error.message}`);
    failed += 1;
  }
}

const proposal = {
  schema: 'ecc.coach-evolution-proposal.v1',
  day: '2026-09-15',
  items: [{
    kind: 'rule-amendment',
    ruleId: 'vague-scope',
    topic: 'scoping',
    counts: { seen: 60, fired: 9, cleanStreakMax: 1, relapseHits: 0 },
    reason: 'a long local-only explanation that must not be forwarded',
  }],
};

console.log('\n=== Testing contribution anonymization ===\n');

test('a clean payload passes', () => {
  const payload = buildContributionPayload(proposal);
  assertAnonymous(payload);
  assert.strictEqual(payload.schema, CONTRIBUTION_SCHEMA);
  assert.strictEqual(payload.items.length, 1);
});

test('the local-only reason text is not forwarded', () => {
  const payload = buildContributionPayload(proposal);
  assert.ok(!JSON.stringify(payload).includes('must not be forwarded'),
    'local analysis prose stays local');
});

test('an unknown rule id is dropped rather than forwarded', () => {
  const payload = buildContributionPayload({
    ...proposal,
    items: [{ kind: 'rule-amendment', ruleId: 'fabricated-rule', counts: {} }],
  });
  assert.strictEqual(payload.items.length, 0);
});

test('user-authored notes are carried, bounded in length', () => {
  const payload = buildContributionPayload(proposal, {
    authored: { 'vague-scope': { en: 'x'.repeat(5000), es: 'una nota' } },
  });
  assert.ok(payload.items[0].authoredNote.en.length <= 600);
  assert.strictEqual(payload.items[0].authoredNote.es, 'una nota');
  assertAnonymous(payload);
});

const REJECTIONS = [
  ['the home directory', { authored: { 'vague-scope': { en: `see ${os.homedir()}/notes` } } }],
  ['the hostname', { authored: { 'vague-scope': { en: `on host ${os.hostname()}` } } }],
  ['a POSIX personal path', { authored: { 'vague-scope': { en: 'broke in /Users/victim/app.js' } } }],
  ['a Windows personal path', { authored: { 'vague-scope': { en: 'broke in C:\\Users\\victim\\app.js' } } }],
  ['a credential shape', { authored: { 'vague-scope': { en: 'key sk-ABCDEF1234567890abcdef' } } }],
  ['an invisible codepoint', { authored: { 'vague-scope': { en: 'looks\u200bclean' } } }],
  ['a sub-day timestamp', { authored: { 'vague-scope': { en: 'happened at 14:32:07' } } }],
];

for (const [label, options] of REJECTIONS) {
  test(`rejects ${label}`, () => {
    const payload = buildContributionPayload(proposal, options);
    assert.throws(() => assertAnonymous(payload), /Refusing to send/,
      `${label} should have been refused`);
  });
}

test('accepts a bare project name in prose, rejects a path naming it', () => {
  const name = path.basename(process.cwd());

  // A bare word is not a leak. Refusing it would make this gate useless for
  // anyone whose project is called "app", "web", or "ecc" -- short names also
  // occur inside our own schema strings.
  const prose = buildContributionPayload(proposal, {
    authored: { 'vague-scope': { en: `this matters for the ${name} project` } },
  });
  assertAnonymous(prose);

  // A path containing it is a leak.
  const asPath = buildContributionPayload(proposal, {
    authored: { 'vague-scope': { en: `broke in /srv/${name}/src/index.js` } },
  });
  assert.throws(() => assertAnonymous(asPath), /Refusing to send/);
});

test('rejects an unexpected top-level field', () => {
  const payload = buildContributionPayload(proposal);
  payload.sessionId = 'abc123';
  assert.throws(() => assertAnonymous(payload), /unexpected top-level field/);
});

test('rejects an unexpected field nested in an item', () => {
  const payload = buildContributionPayload(proposal);
  payload.items[0].promptSample = 'arregla todo';
  assert.throws(() => assertAnonymous(payload), /unexpected item field/);
});

test('rejects a wrong schema', () => {
  const payload = buildContributionPayload(proposal);
  payload.schema = 'something.else.v1';
  assert.throws(() => assertAnonymous(payload), /unexpected schema/);
});

test('checks the serialized string, so nesting cannot hide a value', () => {
  const payload = buildContributionPayload(proposal);
  payload.items[0].counts = { seen: 1, deep: { deeper: { deepest: os.hostname() } } };
  assert.throws(() => assertAnonymous(payload), /Refusing to send/,
    'a value buried three levels down must still be caught');
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
