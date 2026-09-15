#!/usr/bin/env node
/**
 * Show the learner profile derived from local coach history, and mute rules.
 *
 * The profile is a pure PROJECTION of coach-state.json, never an independent
 * tally. Two separately-maintained counters would drift, and then the coach and
 * the profile would disagree about the same person with no way to say which is
 * right. A consequence worth knowing: deleting the profile file loses nothing,
 * because it is rebuilt from state on the next run.
 *
 * Usage:
 *   node scripts/coach-status.js
 *   node scripts/coach-status.js --json
 *   node scripts/coach-status.js --mute <rule-id> | --mute --all | --mute --list
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { readCoachState, writeCoachState } = require('./lib/coach/state');
const { RULES, RULE_IDS, TOPICS, rulesForTopic } = require('./lib/coach/rules');
const { resolveHomunculusDir } = require('./lib/homunculus-dir');
const { writeFileAtomic } = require('./lib/atomic-write');

const PROFILE_SCHEMA = 'ecc.learner-profile.v1';
const FILE_MODE = 0o600;
const MIN_EVIDENCE_FOR_LEVEL = 5;
const MEANINGFUL_PROMPTS = 20;

function deriveProfile(state) {
  const topics = {};
  for (const topic of TOPICS) {
    const rules = rulesForTopic(topic);
    const graduated = [];
    const active = [];
    let evidence = 0;
    for (const rule of rules) {
      const entry = state.rules[rule.id] || {};
      evidence += entry.seen || 0;
      (entry.status === 'graduated' ? graduated : active).push(rule.id);
    }
    let level = rules.length ? Math.floor((4 * graduated.length) / rules.length) : 0;
    if (level === 0 && evidence >= MIN_EVIDENCE_FOR_LEVEL) level = 1;
    topics[topic] = { level, evidence, graduated, active };
  }

  const totalLang = (state.lang.en || 0) + (state.lang.es || 0);
  const esShare = totalLang ? (state.lang.es || 0) / totalLang : 0;

  return {
    schema: PROFILE_SCHEMA,
    ruleVersion: state.ruleVersion,
    updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    promptsObserved: state.promptsSeen || 0,
    language: { primary: esShare > 0.5 ? 'es' : 'en', share: Math.round(esShare * 100) / 100 },
    topics,
  };
}

function profilePath() {
  const root = resolveHomunculusDir();
  return root ? path.join(root, 'profile', 'learner-profile.json') : null;
}

function persistProfile(profile) {
  const target = profilePath();
  if (!target) return null;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeFileAtomic(target, `${JSON.stringify(profile, null, 2)}\n`, { mode: FILE_MODE });
    return target;
  } catch {
    return null; // the profile is a convenience, never a hard requirement
  }
}

function bar(level) {
  return `${'#'.repeat(level)}${'.'.repeat(Math.max(0, 4 - level))}`;
}

function renderText(profile, state) {
  const lines = [];
  lines.push('');
  lines.push('  AI-literacy profile');
  lines.push('  ===================');
  lines.push('');
  lines.push(`  Prompts observed: ${profile.promptsObserved}`);
  lines.push(`  Primary language: ${profile.language.primary} (${Math.round(profile.language.share * 100)}% Spanish)`);
  lines.push('');

  if (profile.promptsObserved < MEANINGFUL_PROMPTS) {
    lines.push(`  NOTE: under ${MEANINGFUL_PROMPTS} prompts observed. Levels below are not`);
    lines.push('  meaningful yet -- there is not enough evidence to read them.');
    lines.push('');
  }

  lines.push('  Topic           Level  Evidence  Graduated  Still active');
  lines.push('  --------------  -----  --------  ---------  ------------');
  for (const topic of TOPICS) {
    const t = profile.topics[topic];
    lines.push(
      `  ${topic.padEnd(14)}  ${bar(t.level)}   ${String(t.evidence).padStart(8)}  ${String(t.graduated.length).padStart(9)}  ${t.active.join(', ') || '-'}`
    );
  }
  lines.push('');

  const graduated = RULE_IDS.filter(id => (state.rules[id] || {}).status === 'graduated');
  if (graduated.length) {
    lines.push('  Graduated (the coach is quiet on these):');
    for (const id of graduated) lines.push(`    - ${id}`);
    lines.push('');
  }

  const noisiest = [...RULES]
    .map(r => ({ id: r.id, fired: (state.rules[r.id] || {}).fired || 0 }))
    .filter(r => r.fired > 0)
    .sort((a, b) => b.fired - a.fired)
    .slice(0, 3);
  if (noisiest.length) {
    lines.push('  Most-seen notes:');
    for (const r of noisiest) lines.push(`    - ${r.id} (${r.fired}x)`);
    lines.push('');
  }

  lines.push('  Mute one:  /coach-mute <rule-id>       Improve them:  /coach-evolve');
  lines.push('');
  return lines.join('\n');
}

function mute(argument) {
  const state = readCoachState();

  if (!argument || argument === '--list') {
    process.stdout.write(`\n  Rules:\n${RULE_IDS.map(id => `    ${((state.rules[id] || {}).status === 'graduated' ? '[muted] ' : '[active] ').padEnd(9)} ${id}`).join('\n')}\n\n`);
    return 0;
  }

  const targets = argument === '--all' ? RULE_IDS : [argument];
  const unknown = targets.filter(id => !RULE_IDS.includes(id));
  if (unknown.length) {
    process.stderr.write(`Unknown rule id: ${unknown.join(', ')}\nKnown ids: ${RULE_IDS.join(', ')}\n`);
    return 1;
  }

  for (const id of targets) {
    state.rules[id].status = 'graduated';
    state.rules[id].relapseHits = 0;
  }
  writeCoachState(state);
  process.stdout.write(`Muted: ${targets.join(', ')}\nThese can return if the same defect appears three more times. See /coach-mute for how to silence permanently.\n`);
  return 0;
}

function main(argv) {
  const args = argv.slice(2);
  const muteIndex = args.indexOf('--mute');
  if (muteIndex !== -1) {
    return mute(args.slice(muteIndex + 1).join(' ').trim());
  }

  const state = readCoachState();
  const profile = deriveProfile(state);
  const written = persistProfile(profile);

  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(renderText(profile, state));
  if (written) process.stdout.write(`  Profile: ${written}\n\n`);
  return 0;
}

module.exports = { deriveProfile, renderText, profilePath, PROFILE_SCHEMA };

if (require.main === module) {
  process.exit(main(process.argv));
}
