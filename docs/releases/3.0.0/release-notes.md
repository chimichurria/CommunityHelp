# CommunityHelp 3.0.0

The first CommunityHelp release. It is a fork of
[Everything Claude Code](https://github.com/affaan-m/ecc) by Affaan Mustafa
(MIT), taken at `8321021c` / v2.2.1 and maintained by
[ChimichurrIA](https://chimichurria.com).

**Why 3.0.0 and not 2.2.2.** This release removes skills and changes default
hook behavior — breaking changes by any reading of semver. It also had to stop
sharing a version number with upstream's 2.2.1: two different things called
2.2.1 is a support problem waiting to happen. Everything under
`docs/releases/` before this file describes upstream's releases, not ours.

The upstream author does not endorse this fork and is not responsible for it.
Do not send issues or security reports about CommunityHelp upstream.

---

## The reason this fork exists: the AI-literacy coach

Most agent tooling assumes you already know how to prompt. This teaches, at the
only moment teaching is cheap — **before** the turn is spent.

```text
You:  arregla todo el codigo del proyecto

      [Nota de prompting: vague-scope] Alcance sin límite. Decime qué archivo o
      comportamiento cambiar — si no, elijo yo, y voy a elegir mal.
      (Silenciar: /coach-mute vague-scope)
```

Eight heuristics run on every prompt. When one fires and you have not already
outgrown it, you get one short note explaining *why* the prompt will cost you
something — in the language you wrote in.

**Then it gets quieter.** At most one note per prompt, never within four prompts
of the last, at most three an hour. Each lesson retires itself: five prompts in
a row where the rule was relevant and you got it right, and it stops appearing.
Slip three times later and it comes back.

The design decision that makes this work is that every rule answers two
*separate* questions — was this relevant, and is the defect present. Mastery is
credited only where a rule was relevant **and** you got it right. Collapse those
into one question and a rule about missing tests would "graduate" off five
prompts like *"what does this file do?"*, and the coach would fall silent having
taught nothing.

New commands: `/coach-status`, `/coach-mute`, `/coach-evolve`,
`/coach-contribute`, `/privacy-audit`.
Full documentation: [`skills/ai-literacy-coach/SKILL.md`](../../skills/ai-literacy-coach/SKILL.md).

### What it stores

Rule IDs, integer counters, and five coarse length buckets. **Never your prompt
text, or any substring of it.**

That is enforced, not promised: `sanitizeState()` rebuilds the document from a
whitelist and runs *inside* the writer, so it cannot be skipped, and there is no
serializable free-text field anywhere in it.
`tests/hooks/coach-privacy.test.js` feeds sentinel values through the real hook
and then greps every byte under a temporary `HOME`.

### Latency, stated plainly

Every hook in this repository is two Node processes — the inline bootstrap plus
a runner child — so the floor is roughly 55–65 ms on macOS regardless of what
the hook does. That is not the coach's doing.

The coach's own marginal cost, enforced as a regression test: **p50 ≈ 5 ms,
p99 ≈ 14 ms**, with a hard self-abort at 15 ms before any I/O. No network, no
subprocess, no transcript reading.

`ECC_HOOK_PROFILE=minimal` removes it from the prompt path entirely, at zero
cost. `ECC_COACH_ENABLED=0` turns it off.

---

## Security: three defaults that acted on your machine without asking

None of these were malicious. All were opt-**out** when they should have been
opt-in, and a stranger installing a plugin should not have to discover them.

1. **The `Stop` hook reformatted your source files** with `--write` on every
   stop — in the `standard` profile, which is the default. Install the plugin,
   and your working tree got rewritten as a side effect of a hook you never
   invoked. Now `strict` profile only.
2. **Both the formatter and `tsc` fell back to `npx`**, which *fetches* the
   package from the registry and executes it. A hook firing automatically is the
   worst possible place for an unannounced supply-chain install. Both now
   resolve only binaries your project already has; the runner fallback requires
   `ECC_ALLOW_TOOL_DOWNLOAD=1`.
3. **The session summary spawned a second inference call** carrying up to 7 KB
   of conversation transcript — spending your tokens and moving your prompt and
   code content into another call, by default. Now gated on
   `ECC_LLM_SUMMARY=1`.

**Removed entirely: the InsAIts security monitor.** Its source asserts "All
processing is local -- no data leaves your machine" while calling a third-party
SDK with full tool input, and it wrote an audit log into your working directory.
We will not ship a privacy guarantee the code contradicts, and leaving it
opt-in would still mean vouching for that sentence.

### A context leak, fixed

On `UserPromptSubmit`, hook stdout is **injected into the model's context**
rather than passed through. The shared hook runner echoes raw stdin on all five
of its fail-open paths — so any disabled or failing prompt-time hook would have
dumped the entire hook payload, session id and transcript path included, into
the conversation on *every prompt*.

Upstream had no hook registered on that event, so the bug was latent there. It
is fixed here and pinned by a test.

### Security reporting

Upstream's `SECURITY.md` routed vulnerability reports to the upstream author. A
report about *this* repository would have reached the wrong person. It now
points at this repository's own private reporting channel, with
<team@chimichurria.com> as an alternative. The four translated copies had the
same defect.

---

## Privacy

[PRIVACY.md](../../PRIVACY.md) is the complete accounting: every place data can
leave the machine, whether it is opt-in, and whether it carries your content.
There is no telemetry, no analytics, and **no hook performs network I/O** —
every outbound path lives in a command you invoke.

`/privacy-audit` checks your own installation: what is stored and with what
permissions, whether any prompt text is in it, and which opt-in variables are
set.

Contributing improvements back is opt-in, shows you the complete anonymized
payload first, and requires typing a confirmation word. The check that gates it
scans the *serialized* payload rather than walking the object graph — an object
walk only inspects the shapes you thought to look for.

---

## Breaking changes

| Change | Who it affects |
|---|---|
| Four Itô Markets skills removed (`ito-baskets`, `ito-compute`, `ito-inference`, `ito-training`) | Anyone invoking them. Two shipped as admittedly non-functional scaffolds. |
| `Stop` auto-format moved to `strict` profile | Anyone relying on automatic formatting on the `standard` profile |
| Formatter/`tsc` registry fallback now requires `ECC_ALLOW_TOOL_DOWNLOAD=1` | Projects without the tool installed locally |
| LLM session summary now requires `ECC_LLM_SUMMARY=1` | Anyone relying on automatic session summaries |
| InsAIts monitor removed | Anyone who had opted into it |
| No npm package | Anyone installing via `npx ecc-universal` — that installs **upstream's** code, not this fork |
| Plugin slug is `communityhelp@communityhelp` | Anyone with `ecc@ecc` installed from this repo's instructions |
| Sponsorship, Pro tier, and Discord automation removed | Nobody: they required credentials a fork cannot have |

### Migration

```bash
git clone https://github.com/chimichurria/CommunityHelp.git
cd CommunityHelp
npm install --ignore-scripts
node scripts/ecc.js setup
```

Or inside Claude Code:

```text
/plugin marketplace add https://github.com/chimichurria/CommunityHelp
/plugin install communityhelp@communityhelp
```

If you want the old formatting and summary behavior back:

```bash
ECC_HOOK_PROFILE=strict ECC_LLM_SUMMARY=1 ECC_ALLOW_TOOL_DOWNLOAD=1
```

---

## Catalog

| | 2.2.1 (upstream) | 3.0.0 |
|---|---:|---:|
| Agents | 68 | 68 |
| Skills | 292 | 289 |
| Commands | 94 | 99 |

## Verification

4,726 tests pass. New code carries 97% line coverage:
`scripts/lib/coach` 98%, the dispatcher 98%, `coach-status` 94%,
`coach-evolve` 93%.

The coach's tests are worth naming, because they test claims rather than shapes:
privacy (sentinels through the real hook, every byte checked), the five cadence
gates at their exact boundaries, a guard that every rule *can* graduate, fail-open
across nine degraded inputs, bilingual output, marginal latency, and that
muting a rule actually stops it firing.

## Known issues, inherited and not fixed

Recorded in [NOTICE.md](../../NOTICE.md) so nobody rediscovers them as
surprises: `schemas/hooks.schema.json` does not validate `hooks/hooks.json`
(pre-dates the fork), `src/llm/providers/openai.py` still offers dated model
names, 13 documentation translations are unmaintained and will drift, and
`.cursor/skills/` and `.agents/skills/` hold copies of canonical skills that had
already drifted upstream.

This fork also inherits upstream's maintenance surface — 289 skills, 21 harness
adapter directories, 13 translations — maintained by one studio. That is stated,
not solved.

## Attribution

The full upstream history (2,700 commits, 1,554 of them the upstream author's)
was pushed unmodified, so every upstream contribution retains its authorship.
`LICENSE` preserves the original copyright verbatim, as MIT requires.
[NOTICE.md](../../NOTICE.md) records what was removed and why.
