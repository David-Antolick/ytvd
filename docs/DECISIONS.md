# Decisions

Append-only log of architectural / design decisions and their rationale.
One entry per decision. Newest at the top. Don't edit old entries — if a
decision is later reversed, add a new entry that supersedes it and link
back.

Format:

```
## YYYY-MM-DD — Short title
**Context:** why this came up.
**Decision:** what we picked.
**Alternatives considered:** what we didn't pick and why.
**Consequences:** what this implies for future work.
**See also:** links to LESSONS.md / code where relevant.
```

---

## 2026-05-15 — Companion-server namespace split: /api/v1/, /playback/, /video/

**Context:** Adding video control alongside music meant deciding how voice
clients (REX) address commands. Three options were on the table: extend the
existing `/api/v1/command` Union with video commands, separate ports per
view, or namespace under `/api/v1/`.

**Decision:** Same port (9863), same auth token, three URL-prefixed
namespaces:
- `/api/v1/*` (root) — music-specific, unchanged from upstream YTMD
- `/api/v1/playback/*` — source-agnostic, routes to whichever view holds the
  audio bus via [SourceCoordinator](../src/main/source-coordinator/index.ts)
- `/api/v1/video/*` — video-specific (search, navigate, display toggles, …)

Plugin-per-namespace inside the Fastify v1 plugin
([api/v1/playback.ts](../src/main/integrations/companion-server/api/v1/playback.ts),
[api/v1/video.ts](../src/main/integrations/companion-server/api/v1/video.ts)).

**Alternatives considered:**
- Extending the existing `/command` Union with everything. Rejected — would
  bloat the schema with semantics-divergent commands (next-song vs
  next-video) and conflate auth scopes.
- Separate ports per view. Rejected — two ports, two tokens, two REX clients
  with no benefit. Plan-doc decision #4 already locked single-port.

**Consequences:** REX gets to share one auth token. `ytmd.py` keeps working
unchanged (music routes preserved). Future video-only command additions
land in `video.ts` without touching music.

**See also:** [docs/YT_VIDEO_FORK_PLAN.md §4](YT_VIDEO_FORK_PLAN.md),
the [REX-side API reference](../../rex_voice_assistant/docs/YTVD_COMPANION_API.md).

---

## 2026-05-15 — Single audio bus enforced in main process by SourceCoordinator

**Context:** Both BrowserViews can produce audio simultaneously. UX-wise
that's broken; the user shouldn't get music + a video playing on top of
each other. Where should the enforcement live?

**Decision:** A new `SourceCoordinator` module in main
([src/main/source-coordinator/index.ts](../src/main/source-coordinator/index.ts))
listens to both views' state IPC, detects paused→playing transitions, and
sends a pause command to the other view. Tracks `activeSource: "music" |
"video" | null` and exposes it to the companion server's `/playback` plugin
so generic commands can route correctly.

**Alternatives considered:**
- Enforce in the preload of whichever view started. Rejected — preloads
  can't talk to each other directly without going through main anyway, and
  the rule belongs at the level that owns both views' lifecycles.
- Have the renderer (Vue) own the rule. Rejected — renderer state is harder
  to reason about and adds a round-trip.

**Consequences:** Voice commands that hit `/playback/command` work without
the caller knowing which source is active. The visible view and active
source can diverge intentionally (user browses music UI while video plays
audio). The plan's "switcher follows audio bus" toggle (deferred to Phase
3) builds on this signal.

**See also:**
[/api/v1/playback/index plugin](../src/main/integrations/companion-server/api/v1/playback.ts).

---

## 2026-05-15 — Unified `persist:ytvd` partition for both BrowserViews

**Context:** Music and video views were initially launched with separate
partitions (`persist:ytmview`, `persist:ytvideoview`), inherited from how
YTMD upstream isolates its music session. That meant Google sign-in didn't
carry across — sign in on YouTube Music, still signed out on YouTube, and
vice versa.

**Decision:** Both views share `persist:ytvd` (production) /
`persist:ytvd-dev` (development). Permission handlers also point at the
shared partition.

**Alternatives considered:**
- Keep separate partitions and write a cookie-migration step on startup.
  Rejected — fragile, fragile, fragile.
- Use one partition but isolate fullscreen / autoplay policies per view via
  webPreferences. Doesn't conflict — already done.

**Consequences:** Single Google sign-in covers both views. Users upgrading
from a pre-2026-05-15 dev build will see a one-time signed-out state and
need to sign in once.

**See also:** [src/main/index.ts createYTMView / createYTVideoView](../src/main/index.ts).

---

## 2026-05-15 — In-window HTML5 fullscreen, not OS-window fullscreen

**Context:** Default Electron behavior: when a page calls
`requestFullscreen()`, the parent BrowserWindow goes full-screen on the OS.
For a media app you might want that, but for YTVD specifically it's jarring
— users want the video to fill the YTVD window, not take over the monitor.

**Decision:** Set `webPreferences.disableHtmlFullscreenWindowResize: true`
on both views. On `enter-html-full-screen`, the BrowserView is resized to
fill the entire window content area (y=0, full height); on
`leave-html-full-screen`, the 36px titlebar offset is restored.

**Alternatives considered:**
- Listen for `enter-html-full-screen` and immediately call
  `mainWindow.setFullScreen(false)` to undo Electron's default. Works but
  causes a visible flash.
- Set `BrowserWindow.fullscreenable: false`. Blocks user-initiated F11
  fullscreen too — too aggressive.

**Consequences:** Predictable behavior — fullscreen always means "fill the
YTVD window," never "take over the desktop." User can still maximize /
fullscreen the YTVD window manually if they want big.

**See also:** [LESSONS.md — Electron auto-fullscreens the parent window…](LESSONS.md).

---

## 2026-05-15 — Fork rather than upstream PR for the video feature

**Context:** Could either ask YTMD to accept a video view as a feature in
upstream, or fork. Upstream-merging a feature like "youtube.com video
control" would broaden YTMD's scope substantially — they've kept tight
focus on music for ~6 years.

**Decision:** Hard fork. Name: YTVD (treated as a pure four-letter mark, do
not expand to dodge the YouTube trademark). License stays GPL-3.0, upstream
copyright preserved, README attributes the fork.

**Alternatives considered:**
- Upstream feature PR. Rejected — scope creep on YTMD's identity.
- Lighter overlay/extension on top of YTMD without forking. Rejected —
  YTMD's BrowserView and IPC are not extension-friendly without code
  changes.

**Consequences:** YTVD ships its own release pipeline (auto-updater
disabled until that's wired). Upstream fixes can be cherry-picked from
`upstream/development`. A later "youtube-property base class" refactor is
the only piece that has a real shot at upstream merge — that's a separate
workstream.

**See also:** [docs/YT_VIDEO_FORK_PLAN.md](YT_VIDEO_FORK_PLAN.md).
