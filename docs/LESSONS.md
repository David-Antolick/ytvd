# Lessons

Append-only log of debugging insights, gotchas, and "things future-me will
forget". Newest at the top. One entry per insight, written so it's
useful when you've forgotten the original context.

Format:

```
## Title (be specific — name the symptom or the surprise)
**Symptom:** what looked broken.
**Root cause:** what was actually broken.
**Fix:** what we did about it.
**Lesson:** the generalizable insight.
**See also:** links to DECISIONS.md / code.
```

---

## Cold-start API play blocked by Chromium autoplay gate

**Symptom:** REX (or any companion-server client) sends `play` /
`playPause` to a freshly launched YTVD, server returns 204, nothing
happens. Clicking the GUI once "fixes" it for the session.

**Root cause:** `continueWhereYouLeftOffPaused` (default `true`) sets
the music view's `autoplayPolicy` to `document-user-activation-required`
at [src/main/index.ts createYTMView](../src/main/index.ts). The
companion IPC's `playerApi.playVideo()` runs without a user gesture, so
Chromium rejects it.

**Fix:** For music `play` / `pause` / `playPause` from `/api/v1/command`
and `/api/v1/playback/command`, run the playerApi call via
`webContents.executeJavaScript(code, true)` — the `userGesture: true`
arg satisfies the gate. The cold-start "resume paused" behavior is
preserved because page load itself still has no gesture.

**Lesson:** `webContents.send` IPC does not carry a user gesture into
the page; for anything autoplay-gated, drive it from main with
`executeJavaScript(code, true)`.

---

## Title-bar overlay buttons paint over fullscreen video

**Symptom:** In fullscreen (HTML5 or window F11), the min/max/close
buttons keep showing as a strip on top of the video.

**Root cause:** Native title-bar overlay (configured via
`titleBarOverlay: { color, symbolColor }`) is part of the window chrome
and paints above BrowserView content regardless of view bounds.

**Fix:** On enter-fullscreen (both HTML5 and OS), call
`mainWindow.setTitleBarOverlay({ color: "#00000000", symbolColor:
"#FFFFFF" })` — transparent background, **visible** symbol color.
Restore `#000000` / `#BBBBBB` on leave. The OS still draws a hover
background on these buttons; if `symbolColor` is also transparent the
hover shows an empty box with no icon, which is worse than the
original problem.

**Lesson:** Resizing a BrowserView to (0,0,w,h) does not cover the
overlay — it's drawn by the OS/DWM, not the renderer. And the
OS-drawn hover bg means symbolColor needs to stay visible even when
the background is transparent.

---

## BrowserView resize lag flashes the main renderer through

**Symptom:** While dragging the window edge to resize, the YTVD
TitleBar (with text "YTVD") and `#222222` background bars flash on
the top and bottom of the BrowserView content.

**Root cause:** Without `setAutoResize`, `BrowserView` only catches up
to its parent `BrowserWindow`'s new size when a `resize` event handler
fires `setBounds`. During the drag the view stays at its old
dimensions, exposing whatever the main renderer paints underneath.

**Fix:** `view.setAutoResize({ width: true, height: true })` on both
`ytmView` and `ytVideoView` right after creation. View now resizes
synchronously with the parent.

**Lesson:** `BrowserView` does **not** auto-resize by default; this
catches everyone exactly once.

---

## Supply-chain `resolutions` catalog (2026-05-20)

`resolutions` in [../package.json](../package.json) is the audit trail
for transitive CVE overrides. Each entry must carry a reason and be
re-evaluated when consumers bump (many become unnecessary over time).

| Resolution                    | Why                                                              |
| ----------------------------- | ---------------------------------------------------------------- |
| `ajv@^8: ^8.20.0`             | Runtime ReDoS in `<8.18.0` (conf tree). Selector scoped to `^8` so it doesn't poison ESLint's ajv-6 chain. |
| `fast-uri: ^3.1.2`            | Runtime path-traversal + host confusion in `<=3.1.1`             |
| `fast-json-stringify: ^6.4.0` | Runtime: pulls patched fast-uri                                  |
| `ws: ^8.20.1`                 | Runtime DoS + memory disclosure (socket.io tree)                 |
| `rollup: ^4.59.0`             | Dev path traversal (vite tree)                                   |
| `postcss: ^8.5.14`            | Dev XSS (vite tree)                                              |
| `node-gyp: ^12.2.0`           | Dev: forces fsevents off `node-gyp@latest` (pinned to 9)         |
| `@electron/rebuild: ^4.0.4`   | Dev: drops `tar@6.x` entirely (cleared 6 advisories)             |
| `cross-spawn: ^7.0.5`         | Dev ReDoS — Forge `@electron-forge/core → username → execa@1` chain otherwise pulls vulnerable `cross-spawn@6.0.6` |
| `brace-expansion@^1.1.7: ^1.1.13` | Dev ReDoS — fires on `minimatch@3.1.5`'s declared `^1.1.7` request (ESLint + Forge) |
| `serialize-javascript: ^7.0.5` | Dev RCE (terser-webpack-plugin)                                 |
| `picomatch: ^4.0.4`           | Dev ReDoS (tinyglobby tree)                                      |
| `diff@^4: ^4.0.4`             | Dev ReDoS scoped to v4 (ts-node tree)                            |
| `yaml: ^2.9.0`                | Dev stack overflow (lint-staged tree)                            |
| `tmp: ^0.2.5`                 | Dev arbitrary write (external-editor tree)                       |
| `@tootallnate/once: ^3.0.1`   | Dev control-flow scoping (http-proxy-agent tree)                 |

**See also:** [DECISIONS.md — Hold Electron on 40.x](DECISIONS.md),
[DECISIONS.md — ESLint 8 → 9](DECISIONS.md).

---

## Deferred CVEs (dev/build only, 2026-05-20)

After the ESLint 9 migration `yarn audit` reports 16 advisories — all
dev/build-only, none in the runtime tree.

1. **ESLint residual** (2): `flatted` via `file-entry-cache@8` →
   `flat-cache@4`, still bundled with ESLint 10. Cleared when upstream
   eslint upgrades file-entry-cache.
2. **Forge installer tooling** (13): `lodash`, `lodash.template`,
   `lodash.get`, `asar`, `glob@7`, `inflight`, `boolean`, `gar`,
   `minimatch@9` (via `@electron/universal`), `rimraf@2` (via `temp`).
   Runs only during `yarn make`. Fix: out of our hands until Forge
   updates.

A new advisory *not* in these clusters is a signal to investigate.

---

## Vite 6 dep-optimizer one-shot TypeError

**Symptom:** After Vite 5 → 6, first `yarn start` (with "Re-optimizing
dependencies because lockfile has changed") emitted a non-fatal
`TypeError: Cannot read properties of undefined (reading 'join')` from
the optimized-deps step. Build proceeded; second start was clean.

**Lesson:** Cache-rebuild path is fragile in Vite 6.x but non-blocking.
Restart to confirm before treating a single such error as a regression.
Workaround if it ever escalates: `rm -rf node_modules/.vite` before
first start.

---

## Yarn `resolutions` selector matches the consumer's exact declared range string

`brace-expansion@^1.1.11: ^1.1.13` was a no-op resolution — the actual
consumer (`minimatch@3.1.5`) declares `brace-expansion: ^1.1.7`, not
`^1.1.11`. The selector form `pkg@<range>` matches the consumer's
declared range string, not a semver intersection. Even
`brace-expansion@^1: ^1.1.13` (broader) didn't fire against a `^1.1.7`
consumer. Only `brace-expansion@^1.1.7: ^1.1.13` (exact match)
triggered.

**Lesson:** When scoping a `resolutions` selector, run `yarn why <pkg>`,
copy the consumer's declared range string verbatim, and use *that* on
the left side. Don't generalize. This contradicts the apparent
generality of the earlier diff lesson — both forms work for some
combinations and not others, so default to the exact-match form.

---

## Unscoped `ajv: ^8.20.0` resolution silently broke `yarn lint`

Adding an unscoped `ajv: ^8.20.0` resolution (for the runtime ReDoS in
conf's chain) crashed every `yarn lint` with `NOT SUPPORTED: option
missingRefs` from `@eslint/eslintrc`'s ajv-6 compat code. ESLint 8 (and
9) still depend on `ajv@^6.14.0` via `@eslint/eslintrc`, and the
resolution forced ajv 8 onto that consumer too — ajv 7 removed
`missingRefs`, so the legacy shim immediately threw.

Worse: lint had been silently broken since the resolution was
introduced. Nobody noticed because the error looked like a transient
node error and `lint-staged` swallowed it on pre-commit.

**Fix:** Scope to `ajv@^8: ^8.20.0` so only consumers in the ajv-8
range get the override.

**Lesson:** Same as the brace-expansion lesson, with sharper teeth.
Unscoped `resolutions` on common packages (ajv, lodash, semver, …) can
hit a hidden major-version branch and break tooling silently. If a
package has multiple co-existing major lines in your tree, always scope
the resolution.

---

## Yarn `resolutions` won't override across a major version boundary

`"diff": "^7.0.0"` to fix a `diff@4.0.2` ReDoS via `ts-node` (which
declares `diff: ^4.0.1`) silently didn't apply — Yarn drops a
resolution when it would put the version outside the consumer's
declared range. Use a scoped selector that stays in range:
`"diff@^4": "^4.0.4"`. Default to the scoped form (`"<pkg>@<original-range>": "<safe>"`)
unless you've separately verified compatibility with the new major.

---

## Yarn 4 `packageExtensions` cannot widen existing peer deps

`packageExtensions` only **adds** missing peer entries — it can't
override existing ones. Tried to widen `fastify-socket.io`'s
`fastify: 4.x.x` peer to `^4 || ^5`; Yarn emitted YN0069 ("rule seems
redundant") and the warning persisted. Treat YN0069 as "the rule did
nothing." For widening, use `yarn patch` (with caveat below) or replace
the dep.

---

## Yarn 4 patches modify on-disk content but keep cached peer metadata

`yarn patch` + `yarn patch-commit` writes the patch and updates
`node_modules`, but Yarn snapshots `peerDependencies` in `yarn.lock` at
original-resolution time and doesn't refresh from the patched archive.
Peer warnings keep firing after a correct patch. For peer changes,
replace the dep. `yarn patch` is fine for code/runtime fixes.

---

## `fsevents` declares `node-gyp: "latest"` — pins to whatever was current

A `yarn audit` hit on `tar@6.2.1` via `node-gyp@9.4.0` persisted even
after bumping `@electron/rebuild` to 4.x (which uses node-gyp 12).
Cause: `fsevents` (macOS-only) declares `node-gyp: "latest"` literally;
Yarn froze that to whatever was current at lockfile creation and never
refreshes. Fix: force `node-gyp: "^12.2.0"` in resolutions. When an
audit hit points at a version you don't recognize, search `yarn.lock`
for `"npm:latest"`.

---

## Bare `yarn up <pkg>` jumps to absolute latest

`yarn up vite` jumped 5.4.21 → 8.0.13 (three majors) and rewrote the
constraint to `^8.0.13`. Bare `yarn up` is "remove + add at latest."
For a contained bump, specify the upper bound: `yarn up vite@^5` or
`yarn up vite@^5.4`.

---

## YouTube home page renders blank until the BrowserView is shown — needs a forced reload on first attach

**Symptom:** After clicking the title-bar switcher to show the YouTube view
for the first time, the home page came up empty — no video grid, just the
shell. Manually pressing F5 fixed it permanently for that session.

**Root cause:** The `ytVideoView` BrowserView is created at app startup and
calls `loadURL("https://www.youtube.com/")` immediately. But at that point
it's not attached to any window, so its content bounds are 0×0. YouTube's
layout uses IntersectionObserver / Page Visibility API to decide what to
render — a zero-sized viewport produces an empty layout, and YouTube never
re-runs that layout when the BrowserView is later attached and resized.

**Fix:** Track a one-shot flag (`ytVideoViewEverShown`) in
[src/main/index.ts](../src/main/index.ts) and call `webContents.reload()`
the first time `showYTVideoView()` runs. After the reload, the layout
computes against real bounds and persists across show/hide cycles.

**Lesson:** When eager-creating a BrowserView for "alive in background"
behavior, the page may load against zero bounds and never recover. Either
reload on first attach (cheap, one-shot) or lazy-create the BrowserView at
first show (loses the "background audio keeps playing" property).

**See also:** [DECISIONS.md — eager BrowserView creation](DECISIONS.md).

---

## Electron auto-fullscreens the parent window on `requestFullscreen()` — disable with `disableHtmlFullscreenWindowResize`

**Symptom:** Clicking YouTube's fullscreen button in the video view took
the whole YTVD window into OS-level fullscreen mode on the monitor, not
"video fills the YTVD window" as wanted. Manually adding
`enter-html-full-screen` handlers that resized the BrowserView did nothing
visible — the window had already been switched to OS fullscreen.

**Root cause:** Electron's default behavior when a page's HTML5
`requestFullscreen()` succeeds is to put the parent `BrowserWindow` into
OS-level fullscreen mode. This happens before any custom event handler
runs.

**Fix:** Set `webPreferences.disableHtmlFullscreenWindowResize: true` on
both BrowserViews. With that flag, the page enters HTML5 fullscreen
without resizing the window, leaving the custom `enter-html-full-screen`
handler free to size the BrowserView however it wants.

**Lesson:** Embedded media in Electron has a built-in window-fullscreen
coupling. If you want in-window fullscreen UX (video fills the embedded
view, OS window stays put), the flag is required — handler-only solutions
are too late.

**See also:**
[DECISIONS.md — In-window HTML5 fullscreen](DECISIONS.md),
[src/main/index.ts createYTVideoView](../src/main/index.ts).

---

## Vue scoped CSS does not apply to slot content from the parent — the slotted button rendered un-styled and inside the draggable region

**Symptom:** Added a switcher button to TitleBar via its `app-buttons`
named slot. The button rendered as an invisible blob — no width, no
height, no background, and unclickable. Tooltip on hover didn't appear
either.

**Root cause:** Vue's `<style scoped>` adds a data attribute to elements
defined in *that* component's template. Slot content defined in the
**parent** template doesn't get the child's scoping attribute, so the
child's `.app-button` selector doesn't match. The button rendered as a
default `<button>` with no width, no height, no background, and (worse)
without the `-webkit-app-region: no-drag` declaration — so it lived inside
the parent titlebar's `-webkit-app-region: drag` region and was therefore
un-clickable.

**Fix:** Duplicate the relevant `.app-button` rules in the parent
component's own `<style scoped>` block
([src/renderer/windows/main/Index.vue](../src/renderer/windows/main/Index.vue)).

**Lesson:** Slot content's styles are scoped to the **parent**, not the
child. If a slotted element needs to look like the child's native buttons,
either: (a) duplicate the rules in the parent's scoped styles, (b) use
`:slotted()` from the child, or (c) make the button a real prop-driven
feature of the child component (cleaner for repeat-use). Don't expect the
child's scoped CSS to cascade into slot content.

**See also:**
[src/renderer/components/TitleBar.vue](../src/renderer/components/TitleBar.vue),
[Vue scoped CSS slot docs](https://vuejs.org/api/sfc-css-features.html#slotted-selectors).

---

## Husky pre-commit hook hangs commits silently because `yarn` isn't on PATH (corepack-only setup)

**Symptom:** `git commit` looked successful from the editor's UI — no error
banner — but `git log` showed the commit never landed. Working tree stayed
dirty.

**Root cause:** Project ships `.husky/pre-commit` running `yarn
lint-staged`. On a fresh Windows install where Node was installed via
`winget install OpenJS.NodeJS.LTS` and yarn was managed through Corepack
without `corepack enable` ever being run, the literal `yarn` binary isn't
on PATH — only `corepack` is. Hook exits 127 ("command not found"), Git
silently aborts the commit. Squelched by VS Code's UI.

**Fix:** Run `corepack enable` once from an **administrative** PowerShell.
That installs real `yarn.cmd` / `yarn.ps1` shims into `C:\Program
Files\nodejs\` (requires admin for the write). Inside the project
directory, `yarn --version` then prints `4.5.1` (the version pinned by
`package.json` `packageManager` field); outside the project it falls
through to corepack's bundled Yarn 1 default.

**Lesson:** Husky / lint-staged hooks invoke `yarn` directly. On Windows
with corepack-managed Yarn, you need `corepack enable` (with admin
privileges) before commits will go through. Editor-driven Git failures
can look silent — check `git log` after a commit if anything seems off.

**See also:** [.husky/pre-commit](../.husky/pre-commit),
[docs/YT_VIDEO_FORK_PLAN.md — toolchain notes](YT_VIDEO_FORK_PLAN.md).

---

## Permission handlers gated to a single webContents silently deny fullscreen on the second view

**Symptom:** After adding the video BrowserView and wiring
`enter-html-full-screen` handlers, the fullscreen handlers never fired
when YouTube's fullscreen button was clicked on the video view. Music view
fullscreen worked.

**Root cause:** The session permission-check + permission-request handlers
were copied unchanged from upstream YTMD and explicitly checked `webContents
== ytmView.webContents` before granting `"fullscreen"`. For the video
view's webContents the check failed, and Electron's default for a denied
permission request is to suppress the API call entirely — `enter-html-full-screen`
never fires because the page never entered fullscreen.

**Fix:** Broaden the check to either webContents:
`webContents == ytmView?.webContents || webContents == ytVideoView?.webContents`.

**Lesson:** Session-level permission handlers are partition-scoped, not
webContents-scoped. When you add a second BrowserView to an existing
partition, the existing permission handlers WILL receive its permission
requests and WILL deny them unless their `webContents == X` check is
expanded. Easy to miss because the failure mode is silent: the page-side
API call resolves as if the user denied the permission, and no main-process
event fires.

**See also:**
[src/main/index.ts setPermissionCheckHandler](../src/main/index.ts).
