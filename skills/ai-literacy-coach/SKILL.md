---
name: ai-literacy-coach
description: >-
  Teaches prompting at submit time. A UserPromptSubmit hook notices when a
  prompt is likely to waste a turn and says why before the turn is spent,
  bilingual and adaptive. Read this to understand what it stores, why each
  threshold is what it is, or to add a rule.
metadata:
  origin: CommunityHelp
  version: 1.0.0
---

# ai-literacy-coach

Most agent tooling assumes you already know how to prompt. This teaches, at the
only moment teaching is cheap: **before** the turn is spent.

It is a `UserPromptSubmit` hook. On every prompt it runs eight heuristics; when
one fires and you have not already outgrown it, it injects one short note
explaining *why* the prompt will cost you something. Then it gets quieter.

## What it actually does

```
prompt -> features -> rule selection -> cadence gates -> at most one note
```

No network. No LLM call. No transcript reading. One ~1.5 KB JSON file.

## The rules

Each rule answers two separate questions, and keeping them separate is the
design's load-bearing idea:

- **`applies(f)`** — was this rule *relevant* to this prompt?
- **`matches(f)`** — is the defect *present*?

Mastery is credited only where `applies && !matches`. Without the split, a rule
about missing tests would "graduate" off five prompts like *"what does this file
do?"*, where tests were never the point — and the coach would go quiet having
taught nothing.

| id | topic | sev | fires when |
|---|---|---:|---|
| `vague-scope` | scoping | 5 | "arregla todo", "fix everything", "the whole codebase" |
| `no-acceptance-criteria` | specification | 4 | a task with no stated "done when" |
| `code-before-plan` | planning | 4 | a long multi-clause task that never asks for the approach |
| `no-file-anchors` | specification | 3 | no path, no code fence, no backticked identifier |
| `unused-ecc-component` | tooling | 3 | the task matches a skill or agent you are not naming |
| `better-as-plan-mode` | planning | 3 | three or more stacked imperative clauses |
| `stacked-asks` | scoping | 2 | several independent tasks in one message |
| `no-test-mention` | verification | 2 | a code change with no mention of verification |

Notes state a why, never a scold, and exist in English and Spanish at two
lengths. The short form is used when `.claude/identity.json` sets
`preferredStyle.verbosity` to `minimal`.

## The cadence, and why each number

The hard problem is not detecting a weak prompt. It is **staying welcome**: a
coach that fires constantly gets disabled within a week, and a disabled coach
teaches nothing.

| gate | threshold | why that number |
|---|---|---|
| **G0** one note per prompt | 1 | two notes is a lecture |
| **G1** global gap | 4 prompts | firing on more than ~1 in 4 reads as nagging |
| **G1** hourly cap | 3 | bounds a burst without an arbitrary clock lockout |
| **G2** per-rule cooldown | 12 prompts | about one working stretch — long enough to have acted on the note, short enough to re-flag a genuinely repeated mistake in the same session. Counted in prompts, not minutes, so a lunch break does not hand back a free fire |
| **G3** graduation | 5 clean *applicable* prompts | at a pessimistic 50% base error rate, five in a row has p≈0.03 of being luck. Per rule, so the coach goes quiet topic by topic |
| **G4** relapse | 3 post-graduation matches | without it the coach dies permanently after one good week; three rather than one so a single sloppy Friday does not undo demonstrated learning |

Ties break by **novelty first** (least-fired rule wins), then severity, then
declaration order. Teach breadth before depth — someone who has seen
`vague-scope` six times has heard it.

## What it stores

`~/.claude/state/coach-state.json`, mode `0600`. The complete set of fields:

- `promptsSeen`, `firedAt` (up to 3 recent unix seconds)
- `lenBuckets` — counts in five buckets: xs/s/m/l/xl
- `lang` — two integers, `en` and `es`
- per rule: `seen`, `fired`, `cleanStreak`, `relapseHits`, `lastFiredPrompt`, `status`

`~/.claude/state/coach-events.jsonl`, mode `0600`, written only when a note
fires: `{schema, ruleId, lang, lenBucket, firedAt, promptIndex}`.

**Never stored:** your prompt text or any substring of it, character counts
finer than the five buckets, paths, cwd, repo name, git remote, session id,
transcript path, tool names, model name, username, hostname.

That is enforced, not promised: `sanitizeState()` rebuilds the document from a
whitelist and runs *inside* `writeCoachState()`, so it cannot be skipped. There
is no serializable free-text field anywhere in the writer.
`tests/hooks/coach-privacy.test.js` feeds sentinel values through the real hook
and greps every byte under a temporary `HOME` to prove it.

Delete either file any time. The coach rebuilds; you lose only the record of
which lessons you had outgrown.

## Latency, honestly

Every hook in this repository is **two** Node processes: the inline `node -e`
bootstrap plus a `run-with-flags` child. That floor is roughly 55-65 ms on
macOS and is not this hook's doing — `run-with-flags`' `require()` path saves
the third spawn, not the second.

What the coach controls is its **marginal** cost. Measured in
`tests/hooks/coach-robustness.test.js`: **p50 ≈ 5 ms, p99 ≈ 14 ms**, with a
hard self-abort at 15 ms before any I/O. There is a documented decision against
prompt-time hooks in `scripts/hooks/evaluate-session.js:9-13` on latency
grounds; that decision is about *transcript analysis* every message. This reads
no transcript and spawns nothing.

If you want zero prompt-path cost, use `ECC_HOOK_PROFILE=minimal` — the coach
is registered for `standard,strict` only.

## Controls

| variable | effect |
|---|---|
| `ECC_COACH_ENABLED=0` | turn the coach off |
| `ECC_COACH_ALWAYS=1` | a note on every prompt, gates bypassed. A forced note does not consume your rate limit and does not affect your profile, so demos do not distort your learning record |
| `ECC_COACH_EVOLVE=1` | run the local improvement pass at SessionEnd (default off) |
| `ECC_COACH_STATE_PATH` | override the state path (absolute; test seam) |
| `ECC_COACH_EVENTS_PATH` | override the event log path (absolute; test seam) |
| `ECC_DISABLED_HOOKS=prompt:coach` | disable via the standard hook-flag mechanism |

Commands: `/coach-status` shows your profile, `/coach-mute <rule-id>` silences
one rule, `/coach-evolve` proposes improvements from your local history,
`/coach-contribute` offers them upstream after you review an anonymized payload.

## Adding a rule

1. Add an entry to `scripts/lib/coach/rules.js` with a unique `id`, exactly one
   `topic` from `TOPICS`, a `severity`, both `applies` and `matches`, and notes
   in `en` and `es` at `short` and `long`.
2. Add it to the table above.
3. Run `node tests/hooks/coach-cadence.test.js` and
   `node tests/hooks/coach-robustness.test.js`.

`RULE_IDS` is frozen at module load and is the whitelist the state writer
enforces, so a rule that is not in `rules.js` can never write to disk. Keep
`applies` genuinely broader than `matches`, or graduation will be meaningless.

Rules are a starting hypothesis, not received wisdom. `/coach-evolve` reports
which ones never fire (pure latency) and which fire often without ever
producing a clean streak (notes that are not landing) — both are signals to
change the rule rather than defend it.
