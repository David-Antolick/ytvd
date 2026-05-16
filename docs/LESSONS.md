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
