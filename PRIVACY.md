# Privacy

This project installs hooks that run automatically inside your agent sessions.
That is a lot of trust. This document is the complete accounting of what those
hooks touch, where data goes, and what is on by default — so you can verify the
claims instead of believing them.

Run `/privacy-audit` to check your own installation.

## The short version

- **No telemetry, no analytics, no phone-home.** There is no endpoint that
  collects usage from this project. There is no server to collect it.
- **No hook performs network I/O.** Every outbound path below lives in a command
  *you* invoke, never in a hook that fires on its own.
- **The AI-literacy coach never writes prompt text to disk.** Not a substring,
  not a hash of one. Only rule IDs, integer counters, and five coarse length
  buckets.
- **Nothing is contributed upstream without explicit consent** — you see the
  complete payload and type a confirmation word.

## What the coach stores, exactly

`~/.claude/state/coach-state.json` (mode `0600`) holds the complete set:

```json
{
  "schema": "ecc.coach-state.v1",
  "ruleVersion": "1",
  "updatedAt": "2026-09-15T20:41:02Z",
  "promptsSeen": 412,
  "firedAt": [1757880062],
  "lenBuckets": { "xs": 12, "s": 130, "m": 201, "l": 58, "xl": 11 },
  "lang": { "en": 272, "es": 140 },
  "rules": {
    "no-acceptance-criteria": {
      "seen": 31, "fired": 6, "cleanStreak": 7,
      "relapseHits": 0, "lastFiredPrompt": 384, "status": "active"
    }
  }
}
```

`~/.claude/state/coach-events.jsonl` (mode `0600`) holds one line per fired
note: `{schema, ruleId, lang, lenBucket, firedAt, promptIndex}`. Nothing else.
Capped at 2000 entries.

**Never stored, anywhere:** your prompt text or any substring of it, character
counts finer than the five buckets, file paths, working directory, repository
name, git remote, branch, session id, transcript path, tool names, model name,
username, hostname.

### How that is enforced rather than promised

`sanitizeState()` in `scripts/lib/coach/state.js` rebuilds the document field by
field from a whitelist, and it is called **inside** `writeCoachState()` — so it
cannot be bypassed. Top-level keys come from a literal list. Rule keys must
appear in `RULE_IDS`, frozen at module load. Every number must pass
`Number.isInteger` and is clamped. `updatedAt` is regenerated, never copied from
input. The result is that there is no serializable free-text field anywhere in
the writer: a future contributor who tries to stash a prompt snippet there
cannot, and `tests/hooks/coach-privacy.test.js` feeds sentinel values through
the whole hook and then greps every byte under a temporary `HOME` to prove it.

Delete either file at any time. The coach rebuilds from zero; you lose only the
record of which lessons you had already outgrown.

## Complete data-egress inventory

Everything in this repository that can send data off your machine:

| Where | Destination | On by default? | Carries your content? |
|---|---|---|---|
| `scripts/lib/llm-summary.js` (session summary) | a second `claude -p` process | **No** — opt in with `ECC_LLM_SUMMARY=1` | Yes: up to 7 KB of transcript |
| `/coach-contribute` | a pull request to this repo | **No** — you type a confirmation word | Only what you typed and reviewed |
| `skills/taste-*` image generation | fal.ai | No — needs `FAL_KEY` **and** `TASTE_FORGE_ALLOW_LIVE=1` | Yes: generation prompts |
| `skills/social-publisher` | getsocialclaw.com (commercial SaaS) | No — explicit invocation | Yes: post content |
| `skills/continuous-learning-v2` instinct import | a URL you supply | No — explicit invocation | No: inbound fetch, with an SSRF guard |
| `integrations/aura/adapter.py` | agent.auraopenprotocol.org | No | No: inbound, read-only |
| `ecc2` notifications | a Slack/Discord webhook you configure | No — `enabled: false` | Yes: session summaries |

Local-only, never networked: all hooks, `ecc_dashboard.py` (pure Tkinter, zero
network imports), `desktop-notify.js`, the memory vault, the state store, and
the coach.

**Changed from upstream:** the session summary above was **on by default**
(opt-out). It spawned a second inference call carrying transcript content and
spent your tokens without asking. It is opt-in here.

## Other things that changed for your safety

| Upstream behavior | Why it was a problem | Now |
|---|---|---|
| `Stop` hook reformatted your source files on every stop, in the default profile | Rewrote your working tree as a side effect of a hook you did not invoke | `strict` profile only |
| Missing formatter or `tsc` was fetched via `npx` | An unannounced network install, executed automatically | Skipped unless `ECC_ALLOW_TOOL_DOWNLOAD=1` |
| InsAIts security monitor | Asserted "all processing is local -- no data leaves your machine" while calling a third-party SDK with full tool input, and wrote an audit log into your working directory | Removed |

## Local files this project writes

| Path | What |
|---|---|
| `~/.claude/state/coach-state.json` | coach counters (above) |
| `~/.claude/state/coach-events.jsonl` | fired-note log (above) |
| `~/.claude/state/skill-runs.jsonl` | skill execution records; synthesizes descriptions, never stores prompt text |
| `~/.claude/metrics/*.jsonl` | session activity and command log, with token redaction applied |
| `~/.claude/ecc/state.db` | SQLite session/skill/decision store |
| `~/.ecc/memory/`, `<repo>/.ecc/memory/` | memory vault entries you explicitly save |
| `~/.local/share/ecc-homunculus/` | continuous-learning observations, instincts, and the learner profile |

All of these are gitignored. None are transmitted anywhere.

## Reporting a privacy defect

If you can get prompt text into a coach state file, or find a hook that reaches
the network, that is a **security vulnerability**, not a feature request. Report
it privately: see [SECURITY.md](SECURITY.md).
