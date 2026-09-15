---
name: privacy-audit
description: Audit this installation's privacy posture - what is stored locally, what could leave the machine, and whether anything is enabled that should not be.
---

Let the user verify the claims in [PRIVACY.md](../PRIVACY.md) instead of
believing them. Report what you find plainly, including anything that looks
wrong.

## 1. What is stored locally

```bash
for f in ~/.claude/state/coach-state.json ~/.claude/state/coach-events.jsonl \
         ~/.claude/state/skill-runs.jsonl ~/.claude/metrics/*.jsonl; do
  [ -e "$f" ] && printf '%s  %s  %s\n' "$(stat -f '%Sp' "$f" 2>/dev/null || stat -c '%A' "$f")" "$(wc -c < "$f" | tr -d ' ')" "$f"
done
```

Every one of these should be mode `-rw-------` (0600). Report any that is not:
a world-readable state file is a real finding.

## 2. Does any of it contain prompt text?

The coach's central claim is that it never persists prompt text. Check it
against the user's own history rather than asserting it:

```bash
cat ~/.claude/state/coach-state.json 2>/dev/null
```

Read the output with the user. Every value should be an integer, a rule id, a
five-bucket name, `en`/`es`, or a timestamp. If you see a fragment of anything
they typed, **stop and tell them clearly** — that is a vulnerability, and
SECURITY.md explains how to report it.

## 3. What is enabled that could send data

```bash
env | grep -E '^ECC_(LLM_SUMMARY|ALLOW_TOOL_DOWNLOAD|COACH)' || echo "none set (all defaults)"
```

Explain what each one that is set actually does:

- `ECC_LLM_SUMMARY=1` — sends up to 7 KB of conversation transcript to a second
  `claude -p` call at session end, and spends their tokens
- `ECC_ALLOW_TOOL_DOWNLOAD=1` — lets hooks fetch and execute a missing formatter
  or `tsc` from the package registry
- `ECC_COACH_ALWAYS=1` — a coaching note on every prompt

None of these is on by default. If one is set, say who probably set it — a
shell profile, a CI config, or a previous install.

## 4. Repository-level checks

```bash
npm run security:ioc-scan
node scripts/ci/validate-no-personal-paths.js
git ls-files | grep -E 'coach-state|coach-events|learner-profile' || echo "OK: no local state is tracked by git"
```

The last one matters most for anyone who forks this or opens a pull request:
learner state must never be committed.

## 5. Report

Give a short verdict: what is stored, what is enabled, and whether anything
looks wrong. If everything is at defaults, say so in one line — do not pad it.
If something is off, say exactly what and what to do about it.
