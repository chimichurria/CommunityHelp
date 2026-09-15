---
name: coach-mute
description: Silence one coaching rule, or all of them, without disabling the coach entirely.
argument-hint: <rule-id> | --all | --list
---

Silence a coaching rule the user does not want to see.

`$ARGUMENTS` is a rule id (for example `no-test-mention`), `--all`, or
`--list`.

Run:

```bash
node scripts/coach-status.js --mute "$ARGUMENTS"
```

This marks the rule `graduated` in `~/.claude/state/coach-state.json`. Nothing
else changes, and no file outside that state file is touched.

Tell the user two things they will otherwise be surprised by:

- A muted rule can come back. The coach treats mute as graduation, and
  graduation reverses after three later prompts that hit the same defect. If
  they want it gone permanently, `ECC_DISABLED_HOOKS=prompt:coach` disables the
  coach entirely, and `ECC_HOOK_PROFILE=minimal` removes it from the prompt path
  at zero cost.
- If they are muting a rule because the note is wrong or annoying rather than
  because they have mastered it, that is worth knowing — `/coach-evolve`
  collects exactly that signal, and a bad note is a bug in the rule, not in them.

Related: `/coach-status`, `/coach-evolve`.
