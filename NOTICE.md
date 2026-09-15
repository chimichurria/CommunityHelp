# NOTICE

## Origin and attribution

**CommunityHelp** is a fork of **Everything Claude Code (ECC)** by **Affaan Mustafa**,
licensed under the MIT License.

| | |
|---|---|
| Upstream repository | <https://github.com/affaan-m/ecc> |
| Forked at commit | `8321021c` |
| Upstream version | `2.2.1` |
| Upstream license | MIT — see [LICENSE](LICENSE) |
| Fork maintainer | ChimichurrIA — <https://chimichurria.com> |

The original copyright notice is preserved verbatim in `LICENSE`, as the MIT
License requires. The full upstream commit history (2,700 commits) was pushed
to this repository unmodified, so every upstream contribution retains its
original authorship. Everything this fork changes lands as commits on top of
that history and is attributable to this fork, not to the upstream author.

**The upstream author does not endorse this fork and is not responsible for it.**
Do not send support requests, bug reports, or security reports about
CommunityHelp to the upstream author. See [SECURITY.md](SECURITY.md).

---

## What this fork removed, and why

The upstream repository is a working repository: it carries content specific to
its author's employer and business, plus automation that assumes maintainer
credentials. None of that is usable by a third party, and some of it is
actively harmful to a stranger who installs the plugin.

### Defaults that acted on the user's machine without consent

| Removed or disabled | Why |
|---|---|
| `Stop` hook auto-formatting (`stop-format-typecheck.js`) | Rewrote the user's source files with `--write` on every `Stop`, and fell back to `npx` — an unannounced network install. Now `strict` profile only, with the `npx` fallback removed. |
| LLM session summary (`llm-summary.js`) | Sent up to 7 KB of conversation transcript to an extra `claude -p` call, spending the user's tokens. Was opt-**out**; now opt-**in** via `ECC_LLM_SUMMARY=1`. |
| InsAIts security monitor | Asserted "all processing is local — no data leaves your machine" while calling a third-party SDK with full tool input, and wrote an audit log into the current working directory. We will not ship a privacy guarantee the code contradicts. |

### Content specific to the upstream author's business

Removed: the Itô Markets skills (`ito-baskets`, `ito-compute`, `ito-inference`,
`ito-training` — the author's employer and a listed sponsor; two were shipped
as admittedly non-functional scaffolds), sponsorship and commercial-tier
plumbing (`SPONSORING.md`, `SPONSORS.md`, `docs/business/`, the Pro security
roadmap, the operator readiness dashboard's billing gate), the maintainer-only
Discord bot, and the release/announce workflows that require secrets a fork
does not have.

### Security reporting

Upstream `SECURITY.md` routed vulnerability reports to the upstream author.
Left unchanged, a security report about *this* repository would have reached
the wrong person. It now points at this repository's own private reporting
channel.

---

## What this fork added

- **AI-literacy coach** — a `UserPromptSubmit` hook that teaches prompting in
  the moment, bilingual (Spanish/English), with an adaptive cadence that goes
  quiet topic by topic as the person improves. See
  [`skills/ai-literacy-coach/SKILL.md`](skills/ai-literacy-coach/SKILL.md).
- **A published privacy posture** — [PRIVACY.md](PRIVACY.md) lists every place
  data can leave the machine, whether it is opt-in, and whether it carries user
  content. Plus a `/privacy-audit` command so anyone can check their own install
  without reading 53 hook scripts.
- **Local-first learning** — the coach improves from local usage only.
  Contributing anything back is opt-in, shows a full anonymized payload first,
  and requires typing a confirmation word.

---

## Inherited maintenance debt (stated plainly)

This fork inherits upstream's surface area and does not pretend to have solved
it: ~288 skills, 68 agents, 21 harness adapter directories, and 13 documentation
translations. The translations are **kept as upstream left them and are not
maintained here** — they will drift. Content under `.cursor/skills/` and
`.agents/skills/` are copies of canonical skills that had already drifted
upstream.

Upstream tracked its own decay in `docs/legacy-artifact-inventory.md` and
`docs/stale-pr-salvage-ledger.md`; both are still accurate reading.
