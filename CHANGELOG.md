# YTVD Changelog

## [0.1.0] — 2026-05-15

Initial fork. YTVD diverges from YTMD by adding a parallel YouTube video
view alongside the existing YouTube Music view. Music functionality is
preserved unchanged from upstream; everything below is additive or
side-effect of the fork.

### New: YouTube video view

- New `ytVideoView` BrowserView loads `https://www.youtube.com/`, kept
  alive in the background from app startup so audio survives view
  switching.
- Preload at [src/renderer/ytvideoview/preload.ts](src/renderer/ytvideoview/preload.ts)
  hooks the `<video>` element and `#movie_player` API to push state diffs
  (paused/currentTime/duration/volume/muted) and accept play / pause /
  playPause / seekTo / seekRelative / setVolume / setPlaybackRate / mute /
  unmute IPC commands.
- Navigation guard restricts the video view to `youtube.com`,
  `consent.youtube.com`, `accounts.youtube.com`, and Google Accounts
  domains. Anything else opens in the system browser.
- HTML5 fullscreen behavior changed to "video fills the YTVD window," not
  OS-level monitor fullscreen, on both views — see
  [docs/DECISIONS.md](docs/DECISIONS.md).

### New: in-app view switcher

- Title-bar switcher button (left of the home button) toggles which view
  is visible. Icon flips between `smart_display` (when music is shown) and
  `music_note` (when video is shown). Tooltip names the destination.
- Tray menu also gains **Show YouTube Video** and **Show Music** entries.
- Window resize / fullscreen handlers keep both views correctly sized
  whether attached or detached.

### New: SourceCoordinator (single-audio-bus rule)

- New module at [src/main/source-coordinator/index.ts](src/main/source-coordinator/index.ts)
  listens to both views' state IPC, detects paused→playing transitions,
  and sends a pause to whichever source did *not* start.
- Tracks `activeSource: "music" | "video" | null` and exposes it to the
  companion server's generic playback routes.

### New: companion-server API namespaces

Single port (9863), single auth token, three URL prefixes:

| Prefix | Purpose | Status |
|---|---|---|
| `/api/v1/*` (root) | Music — unchanged from YTMD upstream | ✅ |
| `/api/v1/playback/*` | Source-agnostic; routes via SourceCoordinator | ✅ |
| `/api/v1/video/*` | Video-specific | ✅ MVP |

- `/api/v1/playback/state` — GET returns activeSource + paused +
  currentTime + duration + volume + muted from whichever source is active.
- `/api/v1/playback/command` — POST accepts `play`, `pause`, `playPause`,
  `seekTo`, `seekRelative`, `mute`, `unmute`, `volumeUp`, `volumeDown`,
  `setVolume`. Defaults to music if no source is yet active.
- `/api/v1/video/state` — GET returns video view's state regardless of
  audio-bus owner.
- `/api/v1/video/command` — POST accepts `play`, `pause`, `playPause`,
  `seekTo`, `seekRelative`, `toggleFullscreen`, `toggleCaptions`,
  `toggleTheater`, `setPlaybackRate`, `search`, `navigate`. Toggle commands
  drive YouTube's `f` / `c` / `t` keyboard shortcuts via
  `webContents.sendInputEvent`. `search` and `navigate` use
  `webContents.loadURL` directly.

### Changed: shared session partition

- Both BrowserViews now use `persist:ytvd` (production) / `persist:ytvd-dev`
  (development) instead of separate `persist:ytmview` / `persist:ytvideoview`.
  Google sign-in carries across music + video automatically.
- One-time signed-out state on first launch after upgrade — sign in once on
  either view, both share the session afterward.

### Branding

- Strings-only rebrand from `ytmdesktop`/YTMD to `ytvd`/YTVD across 12
  files (package.json, forge.config.ts, window titles, tray, crash dialogs,
  Discord button labels, protocol scheme `ytvd://`). No logic changes.
- Auto-updater hard-disabled at the Vite build-define level
  (`YTMD_DISABLE_UPDATES = true`) until a YTVD release pipeline exists.
  Flip back by uncommenting the dormant block in
  [viteconfig/main.ts](viteconfig/main.ts) and pointing
  `YTMD_UPDATE_FEED_OWNER` / `YTMD_UPDATE_FEED_REPOSITORY` at the YTVD
  release feed.

### Deliberately deferred

- Video-specific commands needing DOM-selector work: `like`, `dislike`,
  `subscribe`, `removeRating`, `nextChapter`, `previousChapter`, `setQuality`,
  `addToQueue`, `addToWatchLater`, `toggleMiniplayer`, `setCaptionLang`.
- WebSocket state pushes for `/playback` and `/video` (currently HTTP GET only).
- REX-side action wiring against the new namespaces — API reference doc
  exists at
  [rex_voice_assistant/docs/YTVD_COMPANION_API.md](../rex_voice_assistant/docs/YTVD_COMPANION_API.md).
- Switcher hotkey binding (button-only for now).
- "Visible view follows audio bus" auto-follow setting.
- Settings UI "Video" section.
- Replacement icon assets (still using upstream YTMD's icon bytes).

### Toolchain notes

- Verified build on Node 24 LTS + Yarn 4.5.1 via Corepack on Windows 11.
- `yarn make` produces a Squirrel.Windows installer at
  `out/make/squirrel.windows/x64/YTVD-0.1.0 Setup.exe` (~131 MB).
- Code signing not configured — SmartScreen warns on first install.
