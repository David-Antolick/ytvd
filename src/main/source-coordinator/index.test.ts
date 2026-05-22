import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const ipcMain = {
    on(event: string, fn: (...args: unknown[]) => void) {
      const arr = listeners.get(event) ?? [];
      arr.push(fn);
      listeners.set(event, arr);
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    removeAllListeners() {
      listeners.clear();
    }
  };
  return { ipcMain, BrowserView: class {} };
});
vi.mock("electron-log", () => ({
  default: { info: () => {} }
}));

import { ipcMain } from "electron";
import { SourceCoordinator } from "./index";

type FakeView = { webContents: { send: ReturnType<typeof vi.fn> } };
function makeView(): FakeView {
  return { webContents: { send: vi.fn() } };
}

describe("SourceCoordinator", () => {
  let coordinator: SourceCoordinator;
  let musicView: FakeView;
  let videoView: FakeView;

  beforeEach(() => {
    coordinator = new SourceCoordinator();
    musicView = makeView();
    videoView = makeView();
    coordinator.provide(musicView as never, videoView as never);
  });

  afterEach(() => {
    ipcMain.removeAllListeners();
  });

  it("pauses the other view when a source starts playing", () => {
    ipcMain.emit("ytVideoView:videoStateChanged", { sender: videoView.webContents }, { paused: false, currentTime: 0, duration: 100, volume: 1, muted: false });

    expect(coordinator.getActiveSource()).toBe("video");
    expect(musicView.webContents.send).not.toHaveBeenCalled();

    ipcMain.emit("ytmView:videoStateChanged", { sender: musicView.webContents }, 1);

    expect(coordinator.getActiveSource()).toBe("music");
    expect(videoView.webContents.send).toHaveBeenCalledWith("ytVideoView:execute", "pause");
  });
});
