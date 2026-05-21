# CLAUDE.md — orientation for AI tooling

This file is the entry-point context for Claude / other AI coding agents
working in this repo. Read it before doing anything substantive.

## What this project is

YTVD is a desktop player that hosts both **YouTube Music** and **YouTube
video** in a single Electron window. It is a hard fork of
[ytmdesktop/ytmdesktop](https://github.com/ytmdesktop/ytmdesktop) (GPL-3.0)
that adds parallel video support while keeping the music side functionally
intact. Personal project, no SLA.

Key invariants:

1. **One window, two BrowserViews, switcher.** A music view and a video
   view both live in one Electron window; a title-bar switcher (and a
   hotkey) flips which one is visible. The hidden view stays alive so
   audio keeps playing.
2. **Single active audio source.** Only one of music/video produces audio
   at a time. Starting playback in either view auto-pauses the other.
   This rule lives in the main process — see
   [src/main/source-coordinator/](src/main/source-coordinator/).
3. **Active view ≠ active source.** Usually they match, but can diverge
   (e.g. browsing the music UI while a video keeps playing audio).
4. **Companion server: single port (9863), single auth token, three
   namespaces.** REX (the voice assistant that drives this app) talks to
   it via:
   - `/api/v1/*` — music-specific, preserved from upstream YTMD.
   - `/api/v1/playback/*` — source-agnostic; routes to whichever view
     owns the audio bus (handled by
     [SourceCoordinator](src/main/source-coordinator/)).
   - `/api/v1/video/*` — video-specific (search, navigate, display
     toggles).
5. **Both BrowserViews share one session partition** (`persist:ytvd` /
   `persist:ytvd-dev`). One Google sign-in covers both views.
6. **HTML5 fullscreen fills the YTVD window, not the OS desktop.**
   `disableHtmlFullscreenWindowResize` is set on both views and the
   BrowserView is resized to fill the window's content area.

## Code map (start-here paths)

- [src/main/index.ts](src/main/index.ts) — Electron entry, window /
  BrowserView creation, fullscreen handling.
- [src/main/source-coordinator/](src/main/source-coordinator/) — owns the
  single-audio-bus rule and `activeSource` state.
- [src/main/integrations/companion-server/api/v1/](src/main/integrations/companion-server/api/v1/)
  — Fastify plugins per namespace ([playback.ts](src/main/integrations/companion-server/api/v1/playback.ts),
  [video.ts](src/main/integrations/companion-server/api/v1/video.ts)).
- [src/renderer/](src/renderer/) — Vue 3 renderer. `ytmview` (music) and
  `ytvideoview` (video) are siblings.
- [src/main/integrations/](src/main/integrations/) — preserved upstream
  integrations: custom-css, discord-presence, notifications,
  volume-ratio. Extend, don't replace.

## Architectural reading order

Skim these before any non-trivial change:

1. [docs/DECISIONS.md](docs/DECISIONS.md) — append-only log of locked
   design decisions and why each was picked. Authoritative for "should I
   change X".
2. [docs/LESSONS.md](docs/LESSONS.md) — debugging insights and gotchas
   (e.g. YouTube renders blank against a 0×0 BrowserView and needs a
   forced first-attach reload).
3. [CHANGELOG.md](CHANGELOG.md) — recent shipped behavior.

If your change contradicts a DECISIONS.md entry, you are reversing a
locked decision — surface that to the user before proceeding, then add a
new dated entry rather than editing the old one.

**Docs style:** `docs/DECISIONS.md` and `docs/LESSONS.md` are **lean
quick-reference logs**, not comprehensive write-ups. Each entry should
be skimmable in under 30 seconds. Lead with the decision or lesson,
keep each section to one or two sentences, drop prose that doesn't
change behavior, only include a table or code block if it earns its
space. Don't paste audit output, transcripts, or long alternative
analyses — link to code/commits instead. If an entry is growing past
~20 lines, it's probably trying to be a design doc; trim it.

## Development environment

YTVD is a **Windows-side native project**. Develop and run it from
PowerShell on Windows, not from WSL. The Electron-Forge + Squirrel
toolchain targets Windows directly; cross-editing from WSL invites
filesystem and line-ending breakage. WSL is fine for Python-side work
and other repos but not this one.

**Toolchain (pinned):**

- Node — version pinned in [.nvmrc](.nvmrc) (currently `24`, an active
  LTS). Use [nvm-windows](https://github.com/coreybutler/nvm-windows):
  `nvm install 24 && nvm use 24`. `package.json#engines` enforces
  `node >=22 <25`.
- Yarn — `yarn@4.5.1`, materialized from `.yarn/releases/` by Corepack
  (`corepack enable`). Do **not** install Yarn globally.
- VS Code — the canonical editor; this repo opens on the Windows side,
  not via Remote-WSL.

**Commands you'll use most:**

| Command                | Purpose                                            |
| ---------------------- | -------------------------------------------------- |
| `yarn install`         | Install deps from `yarn.lock` (Hardened Mode on)   |
| `yarn start`           | Dev build (Electron + Vite HMR)                    |
| `yarn lint` / `:fix`   | ESLint over `.ts` / `.tsx` / `.vue`                |
| `yarn prettier` / `:fix` | Prettier check / write                           |
| `yarn package`         | Build an unpacked app under `out/`                 |
| `yarn make`            | Produce a Squirrel `.exe` installer under `out/`   |
| `yarn audit`           | Vulnerability scan across the full dependency tree |

## Supply chain — house rules

Third-party code is the largest attack surface this project exposes.
Defaults are tuned accordingly; do not relax them without a written
reason.

- **Yarn `enableHardenedMode: true`** in [.yarnrc.yml](.yarnrc.yml). Every
  install re-verifies resolution metadata against the registry, blocking
  lockfile-tampering attacks (e.g. swapping a package's fetch URL while
  leaving the checksum intact).
- **Lockfile is authoritative.** Never run `npm install` against this
  repo — it ignores `yarn.lock` and silently drifts resolutions. If
  `node_modules` looks wrong, delete it and re-run `yarn install`.
- **Pinned package manager** via `package.json#packageManager`. Corepack
  verifies the integrity hash on every invocation. Bump deliberately, in
  its own commit.
- **Electron binary integrity** is handled by `@electron/get`, which
  validates `SHASUMS256.txt` against the Electron team's signing key on
  first install. Leave that path alone.
- **Adding a dependency requires a reason.** Prefer packages with
  multiple maintainers, recent activity, and ideally npm provenance.
  Run `yarn npm audit --all` before opening a PR that mutates
  `yarn.lock`. Dependabot watches the lockfile; major-version bumps are
  reviewed by hand, never auto-merged.
- **Postinstall scripts.** Only the project's own `husky install` is
  expected. If `yarn install` runs an unfamiliar postinstall script,
  stop and investigate before continuing — flag it to the user.
- **`resolutions` block in `package.json` is load-bearing.** It's the
  documented audit trail for transitive-dep CVE overrides — every
  entry must carry a reason. The full catalog and the list of
  deferred (dev/build-only) advisories live in
  [docs/LESSONS.md](docs/LESSONS.md). Read that before adding,
  removing, or relaxing a resolution.

When in doubt, the safer move is to ask before adding the dependency.

## Working style in this repo

- **Don't add features, refactor, or generalize beyond the task.** Bug
  fixes don't carry surrounding cleanup. One-shot operations don't need
  helpers. See the upstream `# Doing tasks` guidance.
- **Don't introduce backwards-compatibility shims** for code only this
  repo calls — delete cleanly when something is no longer used.
- **Don't write WHAT-comments.** Add a comment only when the WHY is
  non-obvious (hidden constraint, subtle invariant, workaround tied to a
  specific bug). Don't reference the current task, fix, or callers.
- **Verify UI changes by running the app.** Type-checking and tests
  validate code correctness, not feature correctness. For anything that
  changes user-visible behavior, run `yarn start` and exercise the
  feature; if you can't, say so explicitly rather than claiming
  success.
- **Match Forge / Vite / Electron version expectations.** Electron 40 +
  Vite 5 + TypeScript 5.9 + Vue 3.5 — when adding tooling, pick versions
  compatible with those, not the bleeding edge.

## Project status (as of 2026-05-20)

- Music + video views both ship; switcher and single-audio-bus rule are
  in place.
- Companion-server API is split into the three namespaces above;
  `playback/*` routes through `SourceCoordinator`.
- Auto-updater is intentionally **disabled** until the YTVD release
  pipeline is wired (upstream's pointed at ytmdesktop releases).
- The fork still cherry-picks bug fixes from upstream
  `ytmdesktop/development` as relevant.
