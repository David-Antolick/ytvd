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

async function callPlayerApi(method: string, arg?: number) {
  const argLiteral = arg === undefined ? "" : `${arg}, true`;
  (
    await webFrame.executeJavaScript(`
      (function() {
        document.querySelector("#movie_player")?.${method}(${argLiteral});
      })
    `)
  )();
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
      await callPlayerApi("seekTo", seconds);
      break;
    }
    case "seekRelative": {
      const delta = Number(value);
      const video = findVideoElement();
      if (!Number.isFinite(delta) || !video) return;
      const target = Math.max(0, Math.min(video.duration || Number.MAX_SAFE_INTEGER, video.currentTime + delta));
      await callPlayerApi("seekTo", target);
      break;
    }
  }
});

window.addEventListener("load", () => {
  watchForVideoElement();
  ipcRenderer.send("ytVideoView:loaded");
});
