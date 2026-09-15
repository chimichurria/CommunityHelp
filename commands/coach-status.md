---
name: coach-status
description: Show your AI-literacy profile - per-topic levels, which coaching rules are active, and which you have graduated from.
---

Show the user their prompting profile from local coach history.

Run:

```bash
node scripts/coach-status.js
```

Then read the output back to them in their language, and say plainly:

- Which topics they have graduated (the coach is now quiet there, and why).
- Which rules are still active, and what the single highest-leverage change
  would be for them next.
- If `promptsSeen` is under 20, say the profile is not yet meaningful rather
  than over-reading it.

Do not lecture. One or two sentences of interpretation is enough; the table
carries the detail.

Related: `/coach-mute` to silence a rule, `/coach-evolve` to propose
improvements from this history.
