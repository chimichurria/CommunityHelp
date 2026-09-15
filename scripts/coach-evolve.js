#!/usr/bin/env node
/**
 * Propose improvements to coaching rules from local usage history.
 *
 * Reads only local files. Sends nothing anywhere: this script PROPOSES and
 * applies nothing, matching the contract of scripts/lib/skill-improvement/
 * amendify.js, whose output it nests rather than reimplements.
 *
 * The two signals that matter, and why they are visible at all:
 *
 *   Dead rules   — applicable often, fired never. Pure latency; loosen or retire.
 *   Inert notes  — fired often, never produced a clean streak. The note is not
 *                  landing. This is the most valuable signal in the system and
 *                  it exists ONLY because relevance (`applies`) is tracked
 *                  separately from the defect (`matches`). A note that does not
 *                  change behavior is a bug in the note, not in the person.
 *
 * Usage:
 *   node scripts/coach-evolve.js --report
 *   node scripts/coach-evolve.js --json
 */

'use strict';

const { readCoachState, readCoachEvents } = require('./lib/coach/state');
const { RULES, RULE_IDS, RULE_VERSION } = require('./lib/coach/rules');

const PROPOSAL_SCHEMA = 'ecc.coach-evolution-proposal.v1';
const DEAD_RULE_MIN_SEEN = 50;
const INERT_NOTE_MIN_FIRED = 5;
const INERT_NOTE_MAX_STREAK = 2;
const MIN_PROMPTS_FOR_SIGNAL = 30;

function analyze(state, events) {
  const items = [];
  const firesByRule = {};
  for (const event of events) {
    firesByRule[event.ruleId] = (firesByRule[event.ruleId] || 0) + 1;
  }

  for (const rule of RULES) {
    const entry = state.rules[rule.id] || {};
    const seen = entry.seen || 0;
    const fired = entry.fired || 0;

    if (seen >= DEAD_RULE_MIN_SEEN && fired === 0) {
      items.push({
        kind: 'rule-retire',
        ruleId: rule.id,
        topic: rule.topic,
        counts: { seen, fired, cleanStreakMax: entry.cleanStreak || 0, relapseHits: entry.relapseHits || 0 },
        reason: `Applicable to ${seen} prompts and never fired. Either its matcher is too strict, or the defect it looks for does not occur in this person's work. Either way it is costing latency on every prompt for nothing.`,
      });
    }

    if (fired >= INERT_NOTE_MIN_FIRED && (entry.cleanStreak || 0) <= INERT_NOTE_MAX_STREAK && entry.status !== 'graduated') {
      items.push({
        kind: 'rule-amendment',
        ruleId: rule.id,
        topic: rule.topic,
        counts: { seen, fired, cleanStreakMax: entry.cleanStreak || 0, relapseHits: entry.relapseHits || 0 },
        reason: `Fired ${fired} times without ever producing a clean streak longer than ${entry.cleanStreak || 0}. The note is being shown and is not changing behavior -- rewrite it to be more concrete about what to do instead.`,
      });
    }
  }

  return items;
}

function buildProposal() {
  const state = readCoachState();
  const events = readCoachEvents();
  const items = analyze(state, events);

  return {
    schema: PROPOSAL_SCHEMA,
    ruleVersion: RULE_VERSION,
    day: new Date().toISOString().slice(0, 10),
    promptsObserved: state.promptsSeen || 0,
    sufficientEvidence: (state.promptsSeen || 0) >= MIN_PROMPTS_FOR_SIGNAL,
    items,
  };
}

function renderReport(proposal) {
  const lines = ['', '  Coach evolution report', '  ======================', ''];
  lines.push(`  Prompts observed: ${proposal.promptsObserved}`);
  lines.push('');

  if (!proposal.sufficientEvidence) {
    lines.push(`  Not enough history yet. Signals below need at least`);
    lines.push(`  ${MIN_PROMPTS_FOR_SIGNAL} observed prompts to mean anything; treat them as noise`);
    lines.push('  until then.');
    lines.push('');
  }

  if (proposal.items.length === 0) {
    lines.push('  No rule changes proposed. Every rule is either firing usefully or');
    lines.push('  has not accumulated enough evidence to judge.');
    lines.push('');
  } else {
    for (const item of proposal.items) {
      lines.push(`  [${item.kind}] ${item.ruleId}  (${item.topic})`);
      lines.push(`    seen ${item.counts.seen}, fired ${item.counts.fired}, best clean streak ${item.counts.cleanStreakMax}`);
      lines.push(`    ${item.reason}`);
      lines.push('');
    }
  }

  lines.push('  This proposes; it applies nothing. To offer an improvement upstream,');
  lines.push('  use /coach-contribute -- it shows the full anonymized payload first.');
  lines.push('');
  return lines.join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  const proposal = buildProposal();

  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(proposal, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(renderReport(proposal));
  return 0;
}

module.exports = { analyze, buildProposal, renderReport, PROPOSAL_SCHEMA, RULE_IDS };

if (require.main === module) {
  process.exit(main(process.argv));
}
