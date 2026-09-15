/**
 * The /coach-status and /coach-mute CLI surface.
 *
 * Covered as a CLI, not just as a library: `npm run coverage` runs c8 with
 * --all over scripts/**, so a top-level script tested only through its exports
 * still counts its rendering and argument handling as uncovered -- and those
 * are the parts a user actually touches.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'coach-status.js');
const DISPATCHER = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'userpromptsubmit-dispatcher.js');

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

function withHome(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-status-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run(home, args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, XDG_DATA_HOME: path.join(home, 'xdg') },
  });
}

function seed(home, prompt, times = 1) {
  for (let i = 0; i < times; i += 1) {
    spawnSync(process.execPath, [DISPATCHER], {
      input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt }),
      encoding: 'utf8',
      env: { ...process.env, HOME: home, XDG_DATA_HOME: path.join(home, 'xdg') },
    });
  }
}

console.log('\n=== Testing coach-status CLI ===\n');

test('renders a profile on a fresh install without crashing', () => {
  withHome(home => {
    const r = run(home);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('AI-literacy profile'));
    assert.ok(r.stdout.includes('Prompts observed: 0'));
  });
});

test('says plainly when there is not enough history to read', () => {
  withHome(home => {
    const r = run(home);
    assert.ok(/not\s+meaningful yet/i.test(r.stdout),
      'a profile built on almost no data should say so rather than be read as fact');
  });
});

test('--json emits a valid profile', () => {
  withHome(home => {
    const r = run(home, ['--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    const profile = JSON.parse(r.stdout);
    assert.strictEqual(profile.schema, 'ecc.learner-profile.v1');
    for (const topic of ['specification', 'scoping', 'planning', 'verification', 'tooling']) {
      assert.ok(profile.topics[topic], `missing topic ${topic}`);
    }
  });
});

test('reflects real usage: graduation shows up in the profile', () => {
  withHome(home => {
    seed(home, 'add a retry in `src/api/client.ts`; done when the existing test passes', 6);
    const profile = JSON.parse(run(home, ['--json']).stdout);
    assert.ok(profile.promptsObserved >= 6);
    assert.ok(profile.topics.verification.level > 0,
      'six clean prompts about a tested change should raise the verification level');
  });
});

test('detects the primary language from usage', () => {
  withHome(home => {
    seed(home, 'arregla el parser del proyecto y revisa los archivos', 4);
    const profile = JSON.parse(run(home, ['--json']).stdout);
    assert.strictEqual(profile.language.primary, 'es');
  });
});

test('--mute --list shows every rule and its state', () => {
  withHome(home => {
    const r = run(home, ['--mute', '--list']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('vague-scope'));
    assert.ok(r.stdout.includes('no-test-mention'));
  });
});

test('--mute silences a rule and says it can come back', () => {
  withHome(home => {
    const r = run(home, ['--mute', 'vague-scope']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('Muted: vague-scope'));
    assert.ok(/can return/i.test(r.stdout),
      'muting is graduation, which reverses -- the user must be told');

    const state = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'state', 'coach-state.json'), 'utf8'));
    assert.strictEqual(state.rules['vague-scope'].status, 'graduated');
  });
});

test('--mute --all silences every rule', () => {
  withHome(home => {
    run(home, ['--mute', '--all']);
    const state = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'state', 'coach-state.json'), 'utf8'));
    for (const [id, entry] of Object.entries(state.rules)) {
      assert.strictEqual(entry.status, 'graduated', `${id} should be muted`);
    }
  });
});

test('a muted rule actually stops firing', () => {
  withHome(home => {
    run(home, ['--mute', '--all']);
    const r = spawnSync(process.execPath, [DISPATCHER], {
      input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'arregla todo el codigo del proyecto' }),
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    });
    assert.strictEqual(r.stdout.trim(), '', `muted rules must not fire, got: ${r.stdout}`);
  });
});

test('an unknown rule id fails loudly and lists the valid ones', () => {
  withHome(home => {
    const r = run(home, ['--mute', 'not-a-rule']);
    assert.strictEqual(r.status, 1);
    assert.ok(r.stderr.includes('Unknown rule id'));
    assert.ok(r.stderr.includes('vague-scope'), 'should list what IS valid');
  });
});

test('writes the profile outside any repository', () => {
  withHome(home => {
    run(home);
    const expected = path.join(home, 'xdg', 'ecc-homunculus', 'profile', 'learner-profile.json');
    assert.ok(fs.existsSync(expected), `expected the profile at ${expected}`);
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(expected).mode & 0o777, 0o600);
    }
  });
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
