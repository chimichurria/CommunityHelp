#!/usr/bin/env node
/**
 * When the coach is allowed to speak.
 *
 * The hard problem is not detecting a weak prompt — it is staying welcome.
 * A coach that fires on every prompt gets disabled within a week, and a
 * disabled coach teaches nothing. Every threshold below is chosen to keep the
 * hook installed.
 *
 * Five gates, cheapest first, short-circuiting:
 *
 *  G0  At most one note per prompt. Two notes is a lecture.
 *  G1  Global rate limit. Firing on more than ~1 in 4 prompts reads as nagging.
 *  G2  Per-rule cooldown, measured in prompts rather than minutes so an idle
 *      lunch break does not hand back a free fire.
 *  G3  Graduation. Five consecutive clean APPLICABLE prompts has p~0.03 of
 *      being luck at a pessimistic 50% base error rate. Per rule, so the coach
 *      goes quiet topic by topic instead of all at once.
 *  G4  Relapse. Without it the coach dies permanently after one good week.
 *      Three rather than one, so a single sloppy Friday does not undo
 *      demonstrated learning.
 *
 * Tiebreak is novelty-first: teach breadth before depth. Someone who has seen
 * `vague-scope` six times has heard it.
 */

'use strict';

const { RULES, RULE_IDS } = require('./rules');
const { nowSeconds } = require('./state');

const GLOBAL_MIN_GAP_PROMPTS = 4;
const GLOBAL_MAX_PER_HOUR = 3;
const RULE_COOLDOWN_PROMPTS = 12;
const GRADUATE_STREAK = 5;
const RELAPSE_MATCHES = 3;
const HOUR_SECONDS = 3600;

function ruleEntry(state, id) {
  return (state.rules && state.rules[id]) || {
    seen: 0, fired: 0, cleanStreak: 0, relapseHits: 0, lastFiredPrompt: 0, status: 'active',
  };
}

/**
 * @returns {{rule: object|null, reason: string, applicable: string[], matching: string[]}}
 */
function selectRule(features, state, options = {}) {
  const now = Number.isInteger(options.now) ? options.now : nowSeconds();
  const forced = Boolean(options.forced);
  const promptIndex = state.promptsSeen + 1;

  const applicable = [];
  const matching = [];
  for (const rule of RULES) {
    let isApplicable = false;
    let isMatch = false;
    try {
      isApplicable = Boolean(rule.applies(features));
      // matches is evaluated even for graduated rules: G4 needs it, and it is free.
      isMatch = isApplicable && Boolean(rule.matches(features));
    } catch {
      continue; // a broken predicate must never break the prompt path
    }
    if (isApplicable) applicable.push(rule.id);
    if (isMatch) matching.push(rule.id);
  }

  if (matching.length === 0) {
    return { rule: null, reason: 'no-match', applicable, matching };
  }

  // ECC_COACH_ALWAYS: bypass G1-G4, highest severity wins.
  if (forced) {
    const best = RULES
      .filter(r => matching.includes(r.id))
      .sort((a, b) => b.severity - a.severity || RULE_IDS.indexOf(a.id) - RULE_IDS.indexOf(b.id))[0];
    return { rule: best || null, reason: 'forced', applicable, matching };
  }

  // G1: global rate limit.
  const recentFires = (state.firedAt || []).filter(t => t > now - HOUR_SECONDS);
  if (recentFires.length >= GLOBAL_MAX_PER_HOUR) {
    return { rule: null, reason: 'g1-hourly-cap', applicable, matching };
  }
  const lastFirePrompt = Math.max(0, ...RULE_IDS.map(id => ruleEntry(state, id).lastFiredPrompt));
  if (lastFirePrompt > 0 && promptIndex - lastFirePrompt < GLOBAL_MIN_GAP_PROMPTS) {
    return { rule: null, reason: 'g1-min-gap', applicable, matching };
  }

  const eligible = [];
  for (const rule of RULES) {
    if (!matching.includes(rule.id)) continue;
    const entry = ruleEntry(state, rule.id);

    // G3: graduated rules stay silent (G4 handles relapse in applyOutcome).
    if (entry.status === 'graduated') continue;

    // G2: per-rule cooldown.
    if (entry.lastFiredPrompt > 0 && promptIndex - entry.lastFiredPrompt < RULE_COOLDOWN_PROMPTS) continue;

    eligible.push(rule);
  }

  if (eligible.length === 0) {
    return { rule: null, reason: 'g2-g3-suppressed', applicable, matching };
  }

  // Novelty first, then severity, then declaration order (deterministic tests).
  eligible.sort((a, b) => {
    const fa = ruleEntry(state, a.id).fired;
    const fb = ruleEntry(state, b.id).fired;
    if (fa !== fb) return fa - fb;
    if (a.severity !== b.severity) return b.severity - a.severity;
    return RULE_IDS.indexOf(a.id) - RULE_IDS.indexOf(b.id);
  });

  return { rule: eligible[0], reason: 'fired', applicable, matching };
}

/**
 * Fold this prompt's outcome into state. Pure: returns a new state object.
 *
 * A forced fire (ECC_COACH_ALWAYS) deliberately does NOT touch firedAt, fired,
 * or lastFiredPrompt, so demoing and debugging never burn the real budget or
 * distort the learner profile. It still updates seen/cleanStreak so the state
 * stays coherent.
 */
function applyOutcome(state, options = {}) {
  const { applicable = [], matching = [], firedRuleId = null, forced = false } = options;
  const now = Number.isInteger(options.now) ? options.now : nowSeconds();
  const features = options.features || {};

  const next = JSON.parse(JSON.stringify(state));
  next.promptsSeen = (next.promptsSeen || 0) + 1;
  const promptIndex = next.promptsSeen;

  if (features.lenBucket && next.lenBuckets && features.lenBucket in next.lenBuckets) {
    next.lenBuckets[features.lenBucket] += 1;
  }
  if (features.lang && next.lang && features.lang in next.lang) {
    next.lang[features.lang] += 1;
  }

  for (const id of RULE_IDS) {
    const entry = next.rules[id] || (next.rules[id] = {
      seen: 0, fired: 0, cleanStreak: 0, relapseHits: 0, lastFiredPrompt: 0, status: 'active',
    });
    const isApplicable = applicable.includes(id);
    const isMatch = matching.includes(id);

    if (!isApplicable) continue;
    entry.seen += 1;

    if (isMatch) {
      entry.cleanStreak = 0;
      // G4: a graduated rule that keeps being violated comes back.
      if (entry.status === 'graduated') {
        entry.relapseHits += 1;
        if (entry.relapseHits >= RELAPSE_MATCHES) {
          entry.status = 'active';
          entry.relapseHits = 0;
        }
      }
    } else {
      // Mastery is credited ONLY here: applicable, and clean.
      entry.cleanStreak += 1;
      if (entry.status === 'active' && entry.cleanStreak >= GRADUATE_STREAK) {
        entry.status = 'graduated';
        entry.relapseHits = 0;
      }
    }
  }

  if (firedRuleId && !forced) {
    const entry = next.rules[firedRuleId];
    if (entry) {
      entry.fired += 1;
      entry.lastFiredPrompt = promptIndex;
    }
    next.firedAt = [...(next.firedAt || []), now].slice(-GLOBAL_MAX_PER_HOUR);
  }

  return next;
}

module.exports = {
  selectRule,
  applyOutcome,
  GLOBAL_MIN_GAP_PROMPTS,
  GLOBAL_MAX_PER_HOUR,
  RULE_COOLDOWN_PROMPTS,
  GRADUATE_STREAK,
  RELAPSE_MATCHES,
};
