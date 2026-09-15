#!/usr/bin/env node
'use strict';

function normalizeAdditionalContext(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .join('\n');
  }

  return String(value || '').trim();
}

function combineAdditionalContext(current, next) {
  const currentText = normalizeAdditionalContext(current);
  const nextText = normalizeAdditionalContext(next);

  if (!currentText) return nextText;
  if (!nextText) return currentText;

  return `${currentText}\n${nextText}`;
}

// Events allowed to carry additionalContext. An allowlist rather than a
// pass-through: a typo'd event name produces output Claude Code silently
// discards, which is the hardest kind of hook bug to notice.
const ADDITIONAL_CONTEXT_EVENTS = Object.freeze([
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'SessionStart',
]);

function buildAdditionalContext(hookEventName, value) {
  const additionalContext = normalizeAdditionalContext(value);
  if (!additionalContext) return '';

  const event = ADDITIONAL_CONTEXT_EVENTS.includes(hookEventName) ? hookEventName : 'PreToolUse';

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext,
    },
  });
}

function buildPreToolUseAdditionalContext(value) {
  return buildAdditionalContext('PreToolUse', value);
}

module.exports = {
  buildAdditionalContext,
  ADDITIONAL_CONTEXT_EVENTS,
  buildPreToolUseAdditionalContext,
  combineAdditionalContext,
  normalizeAdditionalContext,
};
