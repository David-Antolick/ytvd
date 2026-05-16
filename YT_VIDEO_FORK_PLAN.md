# Plan: Fork YTMD for YouTube Video Support

## Context
Hard fork of [ytmdesktop/ytmdesktop](https://github.com/ytmdesktop/ytmdesktop) (GPL-3.0, Electron + TypeScript + Vue + Vite/Forge). Goal: keep music functionality intact, add youtube.com video control as a parallel feature. Drives the REX voice assistant via the existing companion-server protocol on `127.0.0.1:9863`. Personal project, no SLA, best-effort maintenance. Distant stretch goal: architectural refactors land upstream as PRs.

## Naming / branding
- Pick a neutral name (not "YouTube *anything*" — trademark). Candidates: `ytdesktop`, `yt-companion`, `ytm-plus`. **Decide before forking.**
- New icon (don't reuse YTMD's).
- README opens with "Forked from [ytmdesktop/ytmdesktop](https://github.com/ytmdesktop/ytmdesktop) — thanks to the YTMD team for the foundation."
- License stays GPL-3.0, all upstream copyright notices preserved.
- Send a friendly heads-up email to YTMD maintainers after first public release.

## Architecture decisions (locked)

1. **Window model: one window, two BrowserViews, switcher.** Music view and video view both live in a single window; a switcher in the title bar (and a hotkey) flips which one is visible. Both views stay alive in the background so audio keeps playing when hidden.
2. **Audio bus model: single active source.** Only one of music/video produces audio at a time. Starting playback in either view auto-pauses the other. Owned by a `SourceCoordinator` in the main process.
3. **Active view vs active source — separate concepts.** Usually the same, but can diverge (e.g. browsing music UI while a video plays audio). Starting playback nudges the visible view to match by default.
4. **Companion server: extend, single port (9863).** Same auth handshake, one token. New namespaces under `/api/v1/`: `playback/*` (generic), `music/*` (music-specific), `video/*` (video-specific). Single-app replacement — old YTMD gets uninstalled, no port conflict to worry about.
5. **Refactor sequencing: add video first, refactor later.** Get the fork working end-to-end, then optionally split shared infra into a `youtube-property` base class as a separate upstream-PR candidate. Don't let the refactor block the feature.

## What to keep (largely untouched)
- Electron shell, Forge config, Vite build
- `src/main/integrations/companion-server/` — extend with video routes
- `src/main/integrations/{custom-css,discord-presence,notifications,volume-ratio}` — keep
- `src/renderer/{components,windows,store-ipc}` — keep, extend
- Settings UI scaffolding — add a "Video" section
- Existing music functionality — zero regressions

## What to add

### `src/renderer/ytvideoview/` (sibling of `ytmview`)
BrowserView loading `www.youtube.com`. Preload script extracts state via:
- `<video>` element directly: `currentTime`, `duration`, `paused`, `volume`, `playbackRate`
- YT player API: `document.querySelector('#movie_player').getPlayerState() / .seekTo() / .playVideo() / .pauseVideo() / .getVideoData()`
- DOM selectors for: like, dislike, subscribe, theater, miniplayer, fullscreen, captions toggle, next button, autoplay toggle, chapter list, quality menu

Pushes state diffs to main via IPC, mirroring `ytmview` patterns.

### `src/main/source-coordinator/`
Owns the single-audio-bus rule.
- Subscribes to "playback started" events from both views.
- When one starts, sends `pause` to the other.
- Tracks `activeSource: "music" | "video" | null` (null = nothing playing).
- Routes generic `/api/v1/playback/*` commands to the active source.
- Exposes state to the companion server and renderer (for the switcher UI).

### Window switcher (renderer)
Title-bar control + hotkey to flip the visible BrowserView. Default behavior: when audio bus changes hands, visible view follows (overridable in settings).

### Companion server API

Single port (9863), single auth token, three namespaces. **All three are intentionally under-specified — leave room to add commands as the fork grows.**

#### `/api/v1/playback/*` — generic, routes to active source
Initial commands:
- `play`, `pause`, `play-pause`
- `seek-to <s>`, `seek-relative <±s>`
- `set-volume <0-100>`, `volume-up`, `volume-down`, `mute`, `unmute`
- `set-playback-rate <0.25-2.0>`
- `next`, `previous` *(meaning depends on source: next song vs next video)*

Initial state (GET + WS push):
- `activeSource`, `paused`, `currentTime`, `duration`, `volume`, `muted`, `playbackRate`

*Expansion area — fork-only ideas to drop in later:*
- Cross-source queue / "play next" handoff
- Sleep timer
- Loop region (A↔B repeat)

#### `/api/v1/music/*` — music-specific
Whatever YTMD already exposes for its current API (preserve the surface so existing REX integrations don't break), plus headroom for fork additions.

*Expansion area:*
- (left blank — fill in as we identify music features the fork wants beyond upstream)

#### `/api/v1/video/*` — video-specific
Initial commands:
- Engagement: `like`, `dislike`, `remove-rating`, `subscribe`, `unsubscribe`
- Display: `toggle-fullscreen`, `toggle-theater`, `toggle-miniplayer`
- Captions: `toggle-captions`, `set-caption-lang <code>`
- Quality: `set-quality <auto|144|...|2160>`
- Chapters: `next-chapter`, `previous-chapter`
- Queue: `add-to-queue`, `add-to-watch-later`
- Browse: `navigate <home|subs|library>`, `search <query>`

Initial state (GET + WS push):
- videoId, title, channel, channelId
- chapters (list with start times), currentChapterIndex
- captions: enabled, language, availableLanguages
- likeState, subscribeState
- displayMode: default/theater/miniplayer/fullscreen
- quality
- isLive, isAdPlaying

*(Generic playback fields like duration/currentTime/volume live under `/playback`, not duplicated here.)*

*Expansion area:*
- Comment posting / reading (auth-scoped)
- Playlist management
- Watch History scrubbing
- Per-channel notification toggles

### Settings UI section: "Video"
- Default URL on launch
- Default playback speed
- Switcher hotkey binding
- "Visible view follows audio bus" toggle (default on)
- Companion server video API enable toggle

### Optional later
- Video-aware Discord rich presence template *(deferred — moving away from Discord)*

## What to rip out / leave alone
- Last.fm scrobbling — doesn't apply to videos, leave music-only
- Music-specific Discord presence — leave music-only, add a separate video template later

## Refactor opportunity (the upstream-PR play)
After video works end-to-end in your fork, do a clean separate PR against upstream YTMD that:
- Pulls the BrowserView + preload + IPC + companion-property pattern into a `src/main/youtube-property/` base class
- `ytmview` becomes one consumer of the abstraction
- Doesn't add video to upstream — just enables forks like yours to live alongside cleanly

This is the PR that has a real shot at merging because it benefits YTMD itself (cleaner architecture) without scope-creeping their identity.

## REX-side changes (rex_voice_assistant repo)

New file: `rex_main/actions/youtube_video.py`
- Lazy client singleton talking to companion-server video API
- Mirror `ytmd.py` patterns: `safe_call` wrapping, keyring token (reuse existing companion auth), config from `config.yaml`
- Wrappers stay thin per the actions contract

Because of the single-audio-bus model, most actions become **source-agnostic** and hit `/api/v1/playback/*`. They don't need a slot — phrasing is just the natural verb.

Generic actions (route to whichever source holds the audio bus):
- `pause` — "pause"
- `play` — "play", "resume"
- `skip_forward` — "skip ahead", "skip thirty seconds"
- `skip_backward` — "go back", "rewind ten seconds"
- `volume_up` / `volume_down` — "louder", "quieter"
- `mute` / `unmute`
- `set_speed_*` — "speed up", "slow down", "normal speed"
- `next` / `previous` — "next" / "previous" (next song or next video, depending on active source)

Video-specific actions (always route to `/api/v1/video/*` regardless of active source):
- `like_video` — "like this video", "thumbs up"
- `subscribe` — "subscribe to this channel"
- `toggle_fullscreen` — "fullscreen", "exit fullscreen"
- `toggle_theater` — "theater mode"
- `toggle_captions` — "captions on", "captions off"
- `next_chapter` — "next chapter", "skip chapter"

Music-specific actions stay in existing `ytmd.py` action set — unchanged.

**Slot model: dissolved.** Generic commands don't need a slot. Specific commands have unambiguous phrasings ("subscribe" can't apply to music, "shuffle" can't apply to video). No new slot needed.

Files to update on REX side:
- `rex_main/actions/__init__.py` — register new module
- `rex_main/actions/service.py` — `youtube_video_module.warm()` call
- `docs/ACTIONS.md` — add inventory section
- `README.md` — add commands table rows
- `rex_main/default_config.yaml` — add video API config keys
- New `DECISIONS.md` entry recording the fork choice

## Phasing

**Phase 0 — Fork setup (1-2 hours)**
- Fork, rename, update `package.json` + branding strings + icon
- Verify: builds, packages, music still works unchanged

**Phase 1 — MVP video view (one weekend)**
- `ytvideoview` BrowserView loading youtube.com
- Tray menu entry to open it
- Preload exposes: paused state, currentTime, basic play/pause/seek commands
- Companion server: `/api/v1/video/state` + `/api/v1/video/command` for those commands
- REX side: 3-4 actions wired up, manual smoke test

**Phase 2 — Full command surface (one or two weekends)**
- Remaining commands (like/subscribe/fullscreen/theater/captions/speed/chapters)
- WS state-update pushes
- REX side: complete `youtube_video.py` action set

**Phase 3 — Polish**
- Settings UI "Video" section
- Optional: Discord video presence
- Decide whether to chase the upstream-mergeable refactor PR

## Legal / safety constraints
- No ad-skipping (no CSS that hides ads, no auto-click "Skip Ad")
- No yt-dlp, no video downloads
- No auto-like / auto-subscribe without explicit voice intent
- README disclaimer: "Not affiliated with Google or YouTube"
- No YouTube logo, neutral icon
- Mirror YTMD's posture exactly — they've operated safely in this gray zone for 6+ years

## Open questions — resolved
1. **Repo name?** → **YTVD** (treat as a pure four-letter mark, do not expand it in branding to dodge the YouTube trademark).
2. **Window model?** → One window, two BrowserViews, switcher.
3. **Slot model?** → Dissolved by single-audio-bus design. No new slot.
4. **Video Discord rich presence in v1?** → Defer indefinitely (moving away from Discord).
5. **Upstream refactor PR timing?** → After MVP works, as a separate clean PR.

## Still to figure out (not blockers for Phase 0)
- Switcher hotkey default binding.
- Whether the audio-bus auto-pause is instant or has a fade.
- How the switcher should behave when one view has nothing playing yet (default to music view on cold start? remember last visible?).

---

## Phase 0 — done (2026-05-10)

**Workspace:** `./ytvd/` (sibling of this plan doc).

**What was done:**
- Cloned `https://github.com/ytmdesktop/ytmdesktop` into `./ytvd/`.
- Severed fork: `origin` renamed to `upstream` (kept for cherry-picking fixes). No `origin` set yet — GitHub repo creation is a user action.
- Rebrand applied across 12 files (strings only, no logic):
  - `package.json` — name `ytvd`, productName `YTVD`, version reset to `0.1.0`.
  - `forge.config.ts` — executableName, protocol `ytvd://`, mime handler, publisher repo placeholder.
  - 3 HTML window titles (main, settings, authorize-companion).
  - Vue: `Auth.vue`, main `Index.vue` titlebar, `Settings.vue` about tab + made-by line.
  - `src/main/index.ts` — protocol scheme, macOS app menu, window title format, tray tooltip, tray + ytmview context menus, all 3 crash dialogs.
  - `src/main/integrations/discord-presence/index.ts` — button label + URL scheme.
  - `viteconfig/main.ts` — `YTMD_DISABLE_UPDATES` hardcoded `true`, feed owner/repo defaults set to placeholder strings.
  - `README.md` — fork attribution at top, upstream README preserved.
- Auto-updater hard-disabled at the build-define level (must be flipped back when our own release pipeline exists).
- Verified: `corepack yarn install` clean (938 packages, 19s). `corepack yarn start` boots Electron, app shows YTVD branding, music plays, clean shutdown.

**Toolchain (Windows):**
- Node 24 LTS via `winget install OpenJS.NodeJS.LTS`.
- Yarn 4.5.1 via corepack (no global shim — invoke as `corepack yarn ...`).
- PowerShell PATH won't see `node`/`npm`/`corepack` until terminal is reopened post-install.

**Deliberately untouched (don't refactor for cosmetics):**
- `__YTMD_HOOK__` global window var — internal hook into YTM's Redux store, renaming risks breakage.
- `YTMD_*` build-time constants — internal vite defines.
- v1 config migration paths in `src/main/index.ts:1344-1366` — these intentionally read the legacy `youtube-music-desktop-app` userData folder.
- Icon files at `src/assets/icons/ytmd*` — kept original filenames; user will swap bytes later.
- Squirrel `iconUrl` in forge.config — points to upstream raw URL at a pinned commit; replace at release-pipeline setup.

**User-side TODOs before Phase 1 ships externally (not blockers for development):**
- Create GitHub repo, add as `origin`, push initial commit.
- Drop in own icon assets at `src/assets/icons/` (preserve filenames).
- Set `YTMD_UPDATE_FEED_OWNER` / `YTMD_UPDATE_FEED_REPOSITORY` env vars and re-enable the auto-updater when ready to publish.

**Phase 1 entry point:** start in `ytvd/src/renderer/`. Copy `ytmview/` to `ytvideoview/` as the scaffolding base, change the loaded URL to `https://www.youtube.com`, register it where `ytmview` is registered (window creation, IPC channels, preload entry in `forge.config.ts`).
