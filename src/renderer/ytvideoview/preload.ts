// Security model (mirrors src/renderer/ytmview/preload.ts):
// - This preload runs in the isolated world. The DOM is readable directly here.
// - YouTube's `#movie_player` methods (playVideo, pauseVideo, seekTo, etc.) live in the main world,
//   so any call into them must go through webFrame.executeJavaScript.
// - Anything sent over IPC into here is assumed trusted (originates from our own main process).

import { ipcRenderer, webFrame } from "electron";

function findVideoElement(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>("video.html5-main-video") ?? document.querySelector<HTMLVideoElement>("video");
}

function pushState() {
  const video = findVideoElement();
  if (!video) return;
  ipcRenderer.send("ytVideoView:videoStateChanged", {
    paused: video.paused,
    currentTime: video.currentTime,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    volume: video.volume,
    muted: video.muted
  });
}

function attachVideoListeners(video: HTMLVideoElement) {
  const events = ["play", "pause", "seeking", "seeked", "timeupdate", "volumechange", "durationchange", "ended"];
  for (const ev of events) {
    video.addEventListener(ev, pushState);
  }
}

function watchForVideoElement() {
  let current: HTMLVideoElement | null = null;
  const check = () => {
    const video = findVideoElement();
    if (video && video !== current) {
      current = video;
      attachVideoListeners(video);
      pushState();
    }
  };
  check();
  // SPA navigations swap the <video> element. Re-check periodically.
  // TODO Phase 2: replace with MutationObserver on document.body for tighter latency.
  setInterval(check, 1000);
}

async function callPlayerApi(method: string, argsLiteral: string = "") {
  // argsLiteral is a literal JS arg list; callers must pass validated numbers only — no string interpolation of untrusted data.
  (
    await webFrame.executeJavaScript(`
      (function() {
        document.querySelector("#movie_player")?.${method}(${argsLiteral});
      })
    `)
  )();
}

async function readVolumePercent(): Promise<number> {
  const v = await webFrame.executeJavaScript(`
    (function() {
      return document.querySelector("#movie_player")?.getVolume?.() ?? null;
    })()
  `);
  return typeof v === "number" ? v : 0;
}

ipcRenderer.on("ytVideoView:execute", async (_event, command: string, value?: unknown) => {
  switch (command) {
    case "play":
      await callPlayerApi("playVideo");
      break;
    case "pause":
      await callPlayerApi("pauseVideo");
      break;
    case "playPause": {
      const video = findVideoElement();
      await callPlayerApi((video?.paused ?? true) ? "playVideo" : "pauseVideo");
      break;
    }
    case "seekTo": {
      const seconds = Number(value);
      if (!Number.isFinite(seconds)) return;
      await callPlayerApi("seekTo", `${seconds}, true`);
      break;
    }
    case "seekRelative": {
      const delta = Number(value);
      const video = findVideoElement();
      if (!Number.isFinite(delta) || !video) return;
      const target = Math.max(0, Math.min(video.duration || Number.MAX_SAFE_INTEGER, video.currentTime + delta));
      await callPlayerApi("seekTo", `${target}, true`);
      break;
    }
    case "mute": {
      const video = findVideoElement();
      if (video) video.muted = true;
      break;
    }
    case "unmute": {
      const video = findVideoElement();
      if (video) video.muted = false;
      break;
    }
    case "setVolume": {
      const v = Number(value);
      if (!Number.isFinite(v)) return;
      await callPlayerApi("setVolume", `${Math.max(0, Math.min(100, v))}`);
      break;
    }
    case "volumeUp": {
      const current = await readVolumePercent();
      await callPlayerApi("setVolume", `${Math.min(100, current + 10)}`);
      break;
    }
    case "volumeDown": {
      const current = await readVolumePercent();
      await callPlayerApi("setVolume", `${Math.max(0, current - 10)}`);
      break;
    }
    case "setPlaybackRate": {
      const r = Number(value);
      if (!Number.isFinite(r)) return;
      await callPlayerApi("setPlaybackRate", `${Math.max(0.25, Math.min(2, r))}`);
      break;
    }
  }
});

window.addEventListener("load", () => {
  watchForVideoElement();
  ipcRenderer.send("ytVideoView:loaded");
});
