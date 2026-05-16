import { BrowserView, ipcMain } from "electron";
import { Static, Type } from "@sinclair/typebox";
import { FastifyPluginCallback, FastifyPluginOptions } from "fastify";
import Conf from "conf";
import { StoreSchema } from "~shared/store/schema";
import { isAuthValidMiddleware } from "../../api-shared/auth";

// Mirrors the payload that src/renderer/ytvideoview/preload.ts sends via the
// ytVideoView:videoStateChanged IPC channel.
type VideoState = {
  paused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
};

const initialState: VideoState = {
  paused: true,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false
};

const APIV1VideoCommandRequestBody = Type.Union([
  Type.Object({ command: Type.Literal("play") }),
  Type.Object({ command: Type.Literal("pause") }),
  Type.Object({ command: Type.Literal("playPause") }),
  Type.Object({ command: Type.Literal("seekTo"), data: Type.Number({ minimum: 0 }) }),
  Type.Object({ command: Type.Literal("seekRelative"), data: Type.Number() }),
  Type.Object({ command: Type.Literal("toggleFullscreen") }),
  Type.Object({ command: Type.Literal("toggleCaptions") }),
  Type.Object({ command: Type.Literal("toggleTheater") }),
  Type.Object({ command: Type.Literal("setPlaybackRate"), data: Type.Number({ minimum: 0.25, maximum: 2 }) }),
  Type.Object({ command: Type.Literal("search"), data: Type.String({ minLength: 1, maxLength: 200 }) }),
  Type.Object({
    command: Type.Literal("navigate"),
    data: Type.Union([Type.Literal("home"), Type.Literal("subscriptions"), Type.Literal("library")])
  })
]);
type APIV1VideoCommandRequestBodyType = Static<typeof APIV1VideoCommandRequestBody>;

const NAVIGATE_URLS: Record<"home" | "subscriptions" | "library", string> = {
  home: "https://www.youtube.com/",
  subscriptions: "https://www.youtube.com/feed/subscriptions",
  library: "https://www.youtube.com/feed/library"
};

function pressKey(view: import("electron").BrowserView, key: string) {
  view.webContents.sendInputEvent({ type: "keyDown", keyCode: key });
  view.webContents.sendInputEvent({ type: "char", keyCode: key });
  view.webContents.sendInputEvent({ type: "keyUp", keyCode: key });
}

interface CompanionServerAPIv1VideoOptions extends FastifyPluginOptions {
  getStore: () => Conf<StoreSchema>;
  getYtVideoView: () => BrowserView;
}

const CompanionServerAPIv1Video: FastifyPluginCallback<CompanionServerAPIv1VideoOptions> = async (fastify, options) => {
  let currentState: VideoState = { ...initialState };

  const stateListener = (event: Electron.IpcMainEvent, state: VideoState) => {
    const ytVideoView = options.getYtVideoView();
    if (!ytVideoView || event.sender !== ytVideoView.webContents) return;
    currentState = state;
    // TODO Phase 2: emit `video-state-update` on /api/v1/realtime socket.io namespace.
  };
  ipcMain.on("ytVideoView:videoStateChanged", stateListener);

  fastify.addHook("onClose", () => {
    ipcMain.off("ytVideoView:videoStateChanged", stateListener);
  });

  fastify.get(
    "/state",
    {
      config: {
        rateLimit: {
          hook: "preHandler",
          max: 1,
          timeWindow: 1000 * 5,
          keyGenerator: request => request.authId || request.ip
        }
      },
      preHandler: (request, response, next) => isAuthValidMiddleware(options.getStore(), request, response, next)
    },
    (_request, response) => {
      response.send(currentState);
    }
  );

  fastify.post<{ Body: APIV1VideoCommandRequestBodyType }>(
    "/command",
    {
      config: {
        rateLimit: {
          hook: "preHandler",
          max: 2,
          timeWindow: 1000 * 1,
          keyGenerator: request => request.authId || request.ip
        }
      },
      schema: { body: APIV1VideoCommandRequestBody },
      preHandler: (request, response, next) => isAuthValidMiddleware(options.getStore(), request, response, next)
    },
    (request, response) => {
      const ytVideoView = options.getYtVideoView();
      if (!ytVideoView) {
        response.code(503).send({ error: "YouTube Video view unavailable" });
        return;
      }
      const body = request.body;
      switch (body.command) {
        case "play":
        case "pause":
        case "playPause":
          ytVideoView.webContents.send("ytVideoView:execute", body.command);
          break;
        case "seekTo":
        case "seekRelative":
        case "setPlaybackRate":
          ytVideoView.webContents.send("ytVideoView:execute", body.command, body.data);
          break;
        case "toggleFullscreen":
          pressKey(ytVideoView, "f");
          break;
        case "toggleCaptions":
          pressKey(ytVideoView, "c");
          break;
        case "toggleTheater":
          pressKey(ytVideoView, "t");
          break;
        case "search": {
          const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(body.data)}`;
          ytVideoView.webContents.loadURL(url);
          break;
        }
        case "navigate":
          ytVideoView.webContents.loadURL(NAVIGATE_URLS[body.data]);
          break;
      }
      response.code(204).send();
    }
  );
};

export default CompanionServerAPIv1Video;
