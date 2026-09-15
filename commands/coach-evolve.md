---
name: coach-evolve
description: Propose improvements to coaching rules and skills from your local usage history. Proposes only - applies nothing.
argument-hint: [--json]
---

Run the local improvement pass:

```bash
node scripts/coach-evolve.js --report $ARGUMENTS
```

Everything it reads is local: `~/.claude/state/coach-state.json`,
`coach-events.jsonl`, and skill-run records. Nothing is sent anywhere by this
command.

It reports four things:

1. **Dead rules** — never fired despite many applicable prompts. A rule that
   never fires is pure latency; propose loosening or retiring it.
2. **Notes that are not landing** — fired repeatedly but never produced a clean
   streak. This is the most valuable signal in the system, and it exists only
   because relevance (`applies`) is tracked separately from the defect
   (`matches`). A note that does not change behavior is a bug in the note.
3. **Skill amendments** — recurring skill failures, via the existing
   `proposeSkillAmendment()`.
4. **Instinct candidates** — from continuous-learning-v2, at its own thresholds.

**It proposes; it applies nothing.** Read the output to the user and let them
decide. If they want to act on a proposal, make the edit explicitly.

To offer an improvement upstream, use `/coach-contribute` — which shows the
complete anonymized payload first and requires typed confirmation.
