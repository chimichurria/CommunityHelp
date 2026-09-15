---
name: prompt-optimize
description: Analyze a draft prompt and return an optimized, ready-to-paste version. Advisory only - writes no code and runs no commands.
argument-hint: [the prompt you are about to send]
---

Use the `prompt-optimizer` skill on `$ARGUMENTS`.

If `$ARGUMENTS` is empty, use the user's previous message as the draft.

This command is **advisory only**. Produce an improved prompt and explain what
changed and why. Do not write files, do not run commands, and do not begin the
task the prompt describes — even if the user says "just do it". If they want it
executed, they can paste the optimized prompt back.

Where the coach (`skills/ai-literacy-coach`) gives one short note at submit
time, this is the deliberate, long-form version: use it when someone wants to
work on a prompt before sending it.

Return:

1. The optimized prompt, in a code block, ready to copy.
2. A short list of what changed and the reason for each change.
3. Any ECC skill, agent, or command that fits the task and should be named
   explicitly in the prompt.
