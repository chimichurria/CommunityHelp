---
name: coach-contribute
description: Review an anonymized improvement proposal and, only if you approve it, open a pull request upstream. The only path by which anything leaves your machine.
---

This is the **only** command in this repository that sends anything anywhere,
and it does not send until the user has seen the whole payload and typed a
confirmation word.

## What is included

- `ruleId`, `topic`, and counters: `seen`, `fired`, `cleanStreakMax`, `relapseHits`
- `lang` (`en` or `es`), `lenBuckets`, and `day` — no finer than the day
- a note or matcher **the user types during confirmation**

## What is excluded

Prompt text or any substring of it; file paths; repository name, remote, or
branch; cwd, hostname, username, home directory; session id; timestamps finer
than the day; model name; and `task_description` / `failure_reason` from
skill-run records, both of which are unvalidated free text.

## Procedure

1. Build the proposal and payload:

   ```bash
   node scripts/coach-evolve.js --json
   ```

2. Print the **complete** payload as pretty JSON, plus a plain-language summary
   of each proposed item. Do not summarize instead of showing it — the point is
   that they see exactly what would be sent.

3. Ask the user to type the literal word `contribute`. Not `y`, not Enter.
   A public, irreversible action should cost more than one keystroke, and the
   friction is deliberate. If they type anything else, stop and send nothing.

4. Only after that, open the pull request with `gh pr create`, with the payload
   in a fenced code block in the body.

5. Immediately before the `gh` call, re-run the anonymization check on the exact
   string being sent, in case anything changed between the preview and the send.

If the anonymization check throws, **stop**. Show the user which field tripped
it. Do not strip the offending value and retry: a check that fires means the
payload contains something the design says it cannot contain, and that is worth
understanding rather than working around.

No hook ever performs network I/O. This runs in the user's session, under their
GitHub account, and is visible in the transcript.

Related: `/coach-evolve` to see proposals without sending anything.
