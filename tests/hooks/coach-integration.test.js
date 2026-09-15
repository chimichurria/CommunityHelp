/**
 * Integration points the coach depends on, each of which fails silently if it
 * breaks -- which is why they are pinned here rather than left to manual checks.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const { buildAdditionalContext, buildPreToolUseAdditionalContext } = require('../../scripts/hooks/pretooluse-visible-output');
const { resolveHomunculusDir } = require('../../scripts/lib/homunculus-dir');
const hints = require('../../scripts/lib/coach/component-hints.json');

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

console.log('\n=== Testing coach integration points ===\n');

// ---- additionalContext event plumbing ------------------------------------

test('additionalContext carries UserPromptSubmit as its event name', () => {
  // Claude Code DISCARDS a hookSpecificOutput whose hookEventName does not
  // match the firing event. Without this the coach emits nothing at all, and
  // the failure is invisible.
  const out = JSON.parse(buildAdditionalContext('UserPromptSubmit', 'hello'));
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.strictEqual(out.hookSpecificOutput.additionalContext, 'hello');
});

test('the PreToolUse builder is byte-identical to its previous behavior', () => {
  assert.strictEqual(
    buildPreToolUseAdditionalContext('hello'),
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"hello"}}'
  );
});

test('an unknown event falls back rather than emitting a discarded payload', () => {
  const out = JSON.parse(buildAdditionalContext('Nonsense', 'hello'));
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PreToolUse');
});

// ---- raw passthrough suppression -----------------------------------------

function runHookChain(payload, env) {
  return spawnSync(process.execPath, [
    path.join(REPO, 'scripts', 'hooks', 'run-with-flags.js'),
    'prompt:coach',
    'scripts/hooks/userpromptsubmit-dispatcher.js',
    'standard,strict',
  ], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO, HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'coach-chain-')), ...env },
  });
}

const SENSITIVE = JSON.stringify({
  hook_event_name: 'UserPromptSubmit',
  prompt: 'arregla todo el codigo',
  session_id: 'SESSION-SECRET-123',
  transcript_path: '/Users/victim/.claude/transcript.jsonl',
});

test('a disabled hook emits nothing, never the raw payload', () => {
  // On UserPromptSubmit, hook stdout is INJECTED INTO THE MODEL'S CONTEXT.
  // Echoing raw stdin on a fail-open path would put the session id and
  // transcript path into the conversation on every prompt.
  const result = runHookChain(SENSITIVE, { ECC_HOOK_PROFILE: 'minimal' });
  assert.strictEqual(result.stdout.trim(), '', `leaked payload: ${result.stdout}`);
  assert.ok(!result.stdout.includes('SESSION-SECRET-123'));
});

test('an explicitly disabled coach emits nothing', () => {
  const result = runHookChain(SENSITIVE, { ECC_COACH_ENABLED: '0' });
  assert.strictEqual(result.stdout.trim(), '');
});

test('a missing hook script emits nothing', () => {
  const result = spawnSync(process.execPath, [
    path.join(REPO, 'scripts', 'hooks', 'run-with-flags.js'),
    'prompt:coach', 'scripts/hooks/does-not-exist.js', 'standard,strict',
  ], { input: SENSITIVE, encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO } });
  assert.strictEqual(result.stdout.trim(), '');
});

test('PreToolUse passthrough is unchanged', () => {
  const result = spawnSync(process.execPath, [
    path.join(REPO, 'scripts', 'hooks', 'run-with-flags.js'),
    'pre:bash:dispatcher', 'scripts/hooks/pre-bash-dispatcher.js', 'standard,strict',
  ], {
    input: '{"hook_event_name":"PreToolUse","tool":"Bash"}',
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO, ECC_HOOK_PROFILE: 'minimal' },
  });
  assert.ok(result.stdout.includes('PreToolUse'), 'PreToolUse must still pass its payload through');
});

// ---- component hints ------------------------------------------------------

test('every hinted component still exists on disk', () => {
  const missing = [];
  for (const [keyword, entry] of Object.entries(hints)) {
    if (keyword === '__comment') continue;
    const rel = {
      skill: `skills/${entry.component}/SKILL.md`,
      agent: `agents/${entry.component}.md`,
      command: `commands/${entry.component}.md`,
    }[entry.kind];
    assert.ok(rel, `hint "${keyword}" has an unknown kind: ${entry.kind}`);
    if (!fs.existsSync(path.join(REPO, rel))) missing.push(`${keyword} -> ${rel}`);
  }
  assert.deepStrictEqual(missing, [], 'hints must not advertise components that were deleted');
});

// ---- homunculus dir parity -----------------------------------------------

test('the Node resolver agrees with the shell resolver', () => {
  if (process.platform === 'win32') {
    console.log('    (skipped on win32: no bash resolver)');
    return;
  }
  const sh = path.join(REPO, 'skills', 'continuous-learning-v2', 'scripts', 'lib', 'homunculus-dir.sh');
  if (!fs.existsSync(sh)) {
    console.log('    (skipped: shell resolver not present)');
    return;
  }

  const cases = [
    { CLV2_HOMUNCULUS_DIR: '/abs/override', HOME: '/home/u' },
    { CLV2_HOMUNCULUS_DIR: 'relative/bad', HOME: '/home/u' },
    { XDG_DATA_HOME: '/xdg', HOME: '/home/u' },
    { XDG_DATA_HOME: 'relative/bad', HOME: '/home/u' },
    { HOME: '/home/u' },
    { CLV2_HOMUNCULUS_DIR: '', XDG_DATA_HOME: '', HOME: '/home/u' },
  ];

  for (const env of cases) {
    const shellOut = execFileSync('bash', ['-c', `set -a; . "${sh}"; _clv2_resolve_homunculus_dir`], {
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const nodeOut = resolveHomunculusDir({ env, warn: () => {} });
    assert.strictEqual(nodeOut, shellOut, `divergence for ${JSON.stringify(env)}`);
  }
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
