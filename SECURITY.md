# Security Policy

CommunityHelp is a fork of [Everything Claude Code](https://github.com/affaan-m/ecc)
(MIT, © Affaan Mustafa), maintained by ChimichurrIA.

> **Do not send security reports about CommunityHelp to the upstream author.**
> The upstream project has its own, separate security policy. Reports about the
> code in *this* repository come here.

## Supported versions

| Version | Supported |
| --- | --- |
| `main` | Supported |
| Anything before the fork point (`8321021c`) | Not supported here — report upstream instead |

Security fixes land on `main`. This fork does not maintain backport release lines.

## Reporting a vulnerability

**Preferred:** GitHub private vulnerability reporting. It keeps the report
private until a fix ships and reaches the maintainers directly:

- <https://github.com/chimichurria/CommunityHelp/security/advisories/new>

**Alternative:** email **<team@chimichurria.com>**. Use this if you cannot use
GitHub's flow, or if you want to make first contact before filing details.

Do **not** open a public issue for a security vulnerability.

Include:

- affected file, version, commit, and install path
- steps to reproduce from a clean checkout
- expected impact and which trust boundary it crosses
- whether exploitation needs local shell access, a malicious repo, a malicious
  package, a remote unauthenticated actor, or maintainer credentials
- any PoC logs with tokens, keys, local paths, and private data redacted

This is a community project maintained by one studio, not a funded security
team. We will acknowledge reports as promptly as we can and will tell you
plainly if something is out of scope, not reproducible, or already fixed.
We make no contractual response-time guarantee — please read the timelines
below as intent, not as an SLA.

- **Acknowledgment:** target within a week
- **Assessment and fix or mitigation:** by severity, discussed with you in the report
- **Disclosure:** coordinated, before any public advisory

## Scope

In scope:

- this repository (`chimichurria/CommunityHelp`)
- the plugin, install, hook, rule, skill, command, and MCP surfaces shipped here
- the AI-literacy coach and its local state files
- the GitHub Actions workflows in this repository

Out of scope:

- upstream ECC code as it exists in `affaan-m/ecc` — report that upstream
- Claude Code itself — report to Anthropic
- third-party MCP servers, npm packages, and skills that this repository merely
  documents or configures

## Threat model worth knowing about

This project installs hooks that run automatically in your agent sessions.
Two properties are load-bearing, and a break in either is a security bug worth
reporting:

1. **The coach never persists prompt text.** Only rule IDs, integer counters,
   and coarse buckets reach disk. If you can get any substring of a prompt into
   `~/.claude/state/coach-state.json` or `coach-events.jsonl`, that is a
   vulnerability.
2. **No hook performs network I/O.** Every outbound path is opt-in, documented
   in [PRIVACY.md](PRIVACY.md), and lives in a command you invoke — never in a
   hook that fires on its own. A hook that reaches the network is a
   vulnerability.

See [PRIVACY.md](PRIVACY.md) for the complete data-egress inventory.

## Official distribution surfaces

There is exactly one:

- GitHub repo: <https://github.com/chimichurria/CommunityHelp>
- marketplace/plugin slug: `communityhelp@communityhelp`

This fork is **not published to npm**. Anything on npm claiming to be
CommunityHelp is not ours. The upstream `ecc-universal` package belongs to the
upstream author and is not this project.
