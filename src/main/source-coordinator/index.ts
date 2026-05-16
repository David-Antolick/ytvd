// Owns the single-audio-bus rule: only one of music/video produces audio at a time.
// When one source transitions from paused to playing, we send a pause command to the other.
//
// Tracks `activeSource` (music | video | null) and notifies subscribers (companion server
// generic /playback routes, switcher UI) when it changes.

import { BrowserView, ipcMain } from "electron";
import log from "electron-log";

export type ActiveSource = "music" | "video" | null;

// YT player state enum (from src/renderer/ytmview/preload.ts comments):
// -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
const YTM_STATE_PLAYING = 1;

export type VideoStatePayload = {
  paused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
};

const ZEROED_VIDEO_STATE: VideoStatePayload = {
  paused: true,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false
};

class SourceCoordinator {
  private ytmView: BrowserView | null = null;
  private ytVideoView: BrowserView | null = null;

  // We treat "unknown" as paused so the first play-event triggers a swap.
  private musicPaused = true;
  private videoState: VideoStatePayload = { ...ZEROED_VIDEO_STATE };

  private activeSource: ActiveSource = null;
  private listeners = new Set<(source: ActiveSource) => void>();
  private wired = false;

  public provide(ytmView: BrowserView, ytVideoView: BrowserView): void {
    this.ytmView = ytmView;
    this.ytVideoView = ytVideoView;
    if (!this.wired) {
      this.wireListeners();
      this.wired = true;
    }
  }

  private wireListeners() {
    ipcMain.on("ytmView:videoStateChanged", (event, state: number) => {
      if (!this.ytmView || event.sender !== this.ytmView.webContents) return;
      const wasPaused = this.musicPaused;
      this.musicPaused = state !== YTM_STATE_PLAYING;
      if (wasPaused && !this.musicPaused) {
        this.onSourceStartedPlaying("music");
      }
    });

    ipcMain.on("ytVideoView:videoStateChanged", (event, state: VideoStatePayload) => {
      if (!this.ytVideoView || event.sender !== this.ytVideoView.webContents) return;
      const wasPaused = this.videoState.paused;
      this.videoState = state;
      if (wasPaused && !state.paused) {
        this.onSourceStartedPlaying("video");
      }
    });
  }

  private onSourceStartedPlaying(source: Exclude<ActiveSource, null>): void {
    if (source === "music" && this.ytVideoView && !this.videoState.paused) {
      log.info("SourceCoordinator: music started — pausing video");
      this.ytVideoView.webContents.send("ytVideoView:execute", "pause");
    } else if (source === "video" && this.ytmView && !this.musicPaused) {
      log.info("SourceCoordinator: video started — pausing music");
      this.ytmView.webContents.send("remoteControl:execute", "pause");
    }
    this.setActiveSource(source);
  }

  private setActiveSource(source: ActiveSource): void {
    if (this.activeSource === source) return;
    this.activeSource = source;
    for (const listener of this.listeners) listener(source);
  }

  public getActiveSource(): ActiveSource {
    return this.activeSource;
  }

  public getActiveView(): BrowserView | null {
    if (this.activeSource === "music") return this.ytmView;
    if (this.activeSource === "video") return this.ytVideoView;
    return null;
  }

  public getYtmView(): BrowserView | null {
    return this.ytmView;
  }

  public getYtVideoView(): BrowserView | null {
    return this.ytVideoView;
  }

  public getVideoState(): VideoStatePayload {
    return this.videoState;
  }

  public isMusicPaused(): boolean {
    return this.musicPaused;
  }

  public onActiveSourceChange(listener: (source: ActiveSource) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export default new SourceCoordinator();
