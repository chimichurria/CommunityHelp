/**
 * The load-bearing test for the coach's central claim: no prompt text ever
 * reaches disk.
 *
 * Strategy is deliberately blunt. Feed prompts containing sentinel values
 * through the real hook, then walk EVERY file the run created under a throwaway
 * HOME and assert no sentinel appears in any byte. A test that only inspected
 * the fields it expected would miss exactly the bug that matters: a future
 * change stashing text somewhere nobody thought to look.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dispatcher = require('../../scripts/hooks/userpromptsubmit-dispatcher');
const { sanitizeState, writeCoachState, readCoachState } = require('../../scripts/lib/coach/state');

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

function withTempHome(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-privacy-'));
  const prevHome = process.env.HOME;
  const prevState = process.env.ECC_COACH_STATE_PATH;
  const prevEvents = process.env.ECC_COACH_EVENTS_PATH;
  process.env.HOME = dir;
  delete process.env.ECC_COACH_STATE_PATH;
  delete process.env.ECC_COACH_EVENTS_PATH;
  try {
    return fn(dir);
  } finally {
    process.env.HOME = prevHome;
    if (prevState === undefined) delete process.env.ECC_COACH_STATE_PATH;
    else process.env.ECC_COACH_STATE_PATH = prevState;
    if (prevEvents === undefined) delete process.env.ECC_COACH_EVENTS_PATH;
    else process.env.ECC_COACH_EVENTS_PATH = prevEvents;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function walkFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out;
}

console.log('\n=== Testing coach privacy guarantees ===\n');

// Every sentinel is a shape that must never be persisted: a unique token, a
// home path, a credential, non-Latin text, and an ordinary identifier.
const SENTINELS = [
  'ZZSENTINELZZ',
  '/Users/victim/secret',
  'sk-ABCDEF1234567890abcdef',
  '重构这个模块',
  'flibbertigibbet',
];

const PROMPTS = [
  'arregla ZZSENTINELZZ todo el proyecto entero',
  'fix the flibbertigibbet in /Users/victim/secret/path.js and also update docs',
  'use my key sk-ABCDEF1234567890abcdef to call the api',
  '重构这个模块',
  'refactor everything then add tests and also deploy it',
];

test('no prompt text reaches any file the hook writes', () => {
  withTempHome(home => {
    for (const prompt of PROMPTS) {
      dispatcher.run(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt }), {});
    }

    const files = walkFiles(home);
    assert.ok(files.length > 0, 'expected the hook to write at least one file');

    for (const file of files) {
      const bytes = fs.readFileSync(file, 'utf8');
      for (const sentinel of SENTINELS) {
        assert.ok(
          !bytes.includes(sentinel),
          `${path.relative(home, file)} contains prompt-derived value ${JSON.stringify(sentinel)}`
        );
      }
    }
  });
});

test('sanitizeState drops injected free text at every nesting level', () => {
  const hostile = {
    schema: 'ecc.coach-state.v1',
    ruleVersion: '1',
    updatedAt: 'ZZSENTINELZZ',
    promptsSeen: 3,
    promptText: 'ZZSENTINELZZ',
    firedAt: [1, 'ZZSENTINELZZ'],
    lenBuckets: { xs: 1, evil: 'ZZSENTINELZZ' },
    lang: { en: 1, klingon: 'ZZSENTINELZZ' },
    rules: {
      'vague-scope': { seen: 2, fired: 1, note: 'ZZSENTINELZZ', status: 'ZZSENTINELZZ' },
      'not-a-real-rule': { seen: 9, leak: 'ZZSENTINELZZ' },
    },
    nested: { deep: { deeper: 'ZZSENTINELZZ' } },
  };

  const clean = JSON.stringify(sanitizeState(hostile));
  assert.ok(!clean.includes('ZZSENTINELZZ'), `sanitizeState leaked free text: ${clean}`);
  assert.ok(!clean.includes('not-a-real-rule'), 'sanitizeState kept an unknown rule id');
  assert.ok(!clean.includes('klingon'), 'sanitizeState kept an unknown language key');
  assert.ok(!clean.includes('nested'), 'sanitizeState kept an unknown top-level key');
  // A rule with a bad status is coerced, not dropped, so its counters survive.
  assert.strictEqual(JSON.parse(clean).rules['vague-scope'].status, 'active');
});

test('writeCoachState cannot be made to persist free text', () => {
  withTempHome(() => {
    writeCoachState({ promptsSeen: 1, leaked: 'ZZSENTINELZZ', rules: { 'vague-scope': { seen: 1, why: 'ZZSENTINELZZ' } } });
    const round = JSON.stringify(readCoachState());
    assert.ok(!round.includes('ZZSENTINELZZ'), 'free text survived a write/read round trip');
  });
});

test('state file is created with owner-only permissions', () => {
  if (process.platform === 'win32') {
    console.log('    (skipped on win32: POSIX modes not applicable)');
    return;
  }
  withTempHome(home => {
    dispatcher.run(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'arregla todo el proyecto' }), {});
    const statePath = path.join(home, '.claude', 'state', 'coach-state.json');
    assert.ok(fs.existsSync(statePath), 'expected coach state to exist');
    const mode = fs.statSync(statePath).mode & 0o777;
    assert.strictEqual(mode, 0o600, `expected 0600, got 0${mode.toString(8)}`);
  });
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
