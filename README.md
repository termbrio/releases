<p align="center">
  <img src="assets/brand/termbrio-mark.svg" alt="Termbrio" width="112" />
</p>

<h1 align="center">Termbrio</h1>

<p align="center"><strong>Terminal work, orchestrated.</strong></p>

Termbrio is a local-first runtime for persistent terminal work. It keeps shells,
developer tools, and coding assistants attached to durable named sessions, then
makes those sessions available through one CLI, native apps, a browser console,
and trusted peer devices.

The terminal session is the durable unit of work. A laptop window, phone,
browser tab, CLI invocation, Codex conversation, or Claude Code conversation is
a view or participant; closing a view does not discard the running process or
its place in the workflow.

Termbrio is currently a development preview. This public repository is its
distribution ledger and public product overview while the product source
remains private.

## What Termbrio provides

| Capability | What it provides |
| --- | --- |
| Persistent sessions | Named Windows ConPTY and POSIX PTY sessions that survive view changes and reconnects |
| Multiple work surfaces | Attach through the `tb` CLI, Windows App, Android App, or responsive browser console |
| Trusted peers | Pair Server profiles with single-use invites, QR codes, scoped capabilities, and revocation |
| Repeatable workspaces | Store working directory, shell, environment, and startup defaults |
| Coding-assistant continuity | Launch or resume managed Codex and Claude Code conversations inside known sessions |
| Agent teams | Define member roles, worktrees, providers, conversation policies, and layouts as data |
| TeamRelay | Durable agent inboxes, threads, delivery state, bounded screen reads, and safe terminal notifications |
| Activity and attention | Combine provider hooks with terminal evidence for working, completed, question, permission, failed, and offline state |
| Local automation | Use stable CLI JSON, HTTP contracts, terminal streams, and a Server-hosted MCP endpoint |
| Temporary sharing | Issue revocable, session-scoped browser or CLI access without durable pairing |

## Product surfaces

```text
                    Codex / Claude Code
                     hooks, skills, MCP
                              |
tb CLI ---- Windows/Android App ---- browser console
   \               |                 /
    \-------- Termbrio.Server ------/
                |    |    |
              PTY  SQLite TeamRelay
```

- **Termbrio.Server** owns processes, metadata, pairing, shares, teams,
  assistant activity, TeamRelay, the web console, REST APIs, and the
  `http://127.0.0.1:56789/mcp` endpoint.
- **`tb` CLI** is the direct cross-platform control and automation surface.
- **Termbrio App** provides Windows and Android workbenches.
- **Termbrio Team plugin** gives Codex and Claude Code current CLI guidance,
  activity hooks, TeamRelay MCP messaging, and explicit team orchestration
  workflows.

The public coding-assistant marketplace is
[`termbrio/tbmp`](https://github.com/termbrio/tbmp). It requires an installed
Termbrio Server and does not ship a second runtime.

## Install

Windows:

```powershell
irm https://termbrio.dev/apps/tb/install.ps1 | iex
```

Linux or macOS:

```sh
curl -fsSL https://termbrio.dev/apps/tb/install.sh | sh
```

The protected installation page is available at
<https://termbrio.dev/install.html>. Product and plugin versions advance
independently.

## Public marketplace

Codex:

```powershell
codex plugin marketplace add termbrio/tbmp --ref main
codex plugin add termbrio-team@tbmp
```

Claude Code:

```powershell
claude plugin marketplace add https://github.com/termbrio/tbmp.git#main --scope user
claude plugin install termbrio-team@tbmp --scope user
```

Marketplace installation is anonymous because TBMP is public.

## About this repository

This repository contains no product or marketplace source code. It has two
responsibilities:

1. immutable product packages are attached to GitHub Releases;
2. `catalog/latest.json` records the selected product and plugin versions,
   exact source revisions, tags, and public release links;
3. `catalog/changelog.json` is the append-only public product/plugin release
   history projected from reviewed source changelog entries.

Product assets can include Windows, Linux, and macOS packages, the Android APK,
bootstrap installers, manifests, checksums, and public release notes. Every
published product asset is inventoried with its byte size and SHA256 digest.

Plugins are different: Codex and Claude Code install their contents directly
from the public TBMP repository. A plugin release therefore contributes
versions, source provenance, and a link to the metadata-only TBMP GitHub
Release, but no duplicated plugin archive.

## Release identities

- Product source tag: `termbrio/tb:vX.Y.Z`
- Public product release: `termbrio/releases:product-vX.Y.Z`
- Plugin source and release tag: `termbrio/tbmp:vX.Y.Z`

The namespaces are independent because product and plugin compatibility does
not require matching version numbers.

## Catalog validation

```powershell
node scripts/validate-catalog.mjs
```

Catalog and changelog projection changes are automation-owned. An exact
duplicate release event is idempotent; the same component/version with a
different source revision, entry digest, or prose is rejected. Human edits
should be limited to documentation, schemas, and reviewed release-contract
tooling.
