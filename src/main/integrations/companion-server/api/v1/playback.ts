import { Static, Type } from "@sinclair/typebox";
import { FastifyPluginCallback, FastifyPluginOptions } from "fastify";
import Conf from "conf";
import { StoreSchema } from "~shared/store/schema";
import { isAuthValidMiddleware } from "../../api-shared/auth";
import sourceCoordinator from "../../../../source-coordinator";
import playerStateStore from "../../../../player-state-store";

const APIV1PlaybackCommandRequestBody = Type.Union([
  Type.Object({ command: Type.Literal("play") }),
  Type.Object({ command: Type.Literal("pause") }),
  Type.Object({ command: Type.Literal("playPause") }),
  Type.Object({ command: Type.Literal("seekTo"), data: Type.Number({ minimum: 0 }) }),
  Type.Object({ command: Type.Literal("seekRelative"), data: Type.Number() }),
  Type.Object({ command: Type.Literal("mute") }),
  Type.Object({ command: Type.Literal("unmute") }),
  Type.Object({ command: Type.Literal("volumeUp") }),
  Type.Object({ command: Type.Literal("volumeDown") }),
  Type.Object({ command: Type.Literal("setVolume"), data: Type.Number({ minimum: 0, maximum: 100 }) })
]);
type APIV1PlaybackCommandRequestBodyType = Static<typeof APIV1PlaybackCommandRequestBody>;

interface CompanionServerAPIv1PlaybackOptions extends FastifyPluginOptions {
  getStore: () => Conf<StoreSchema>;
}

const CompanionServerAPIv1Playback: FastifyPluginCallback<CompanionServerAPIv1PlaybackOptions> = async (fastify, options) => {
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
      const active = sourceCoordinator.getActiveSource();
      if (active === "music") {
        const state = playerStateStore.getState();
        response.send({
          activeSource: "music" as const,
          paused: sourceCoordinator.isMusicPaused(),
          currentTime: state.videoProgress ?? 0,
          duration: state.videoDetails?.durationSeconds ?? 0,
          volume: (state.volume ?? 100) / 100,
          muted: state.muted ?? false
        });
      } else if (active === "video") {
        response.send({ activeSource: "video" as const, ...sourceCoordinator.getVideoState() });
      } else {
        response.send({
          activeSource: null,
          paused: true,
          currentTime: 0,
          duration: 0,
          volume: 1,
          muted: false
        });
      }
    }
  );

  fastify.post<{ Body: APIV1PlaybackCommandRequestBodyType }>(
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
      schema: { body: APIV1PlaybackCommandRequestBody },
      preHandler: (request, response, next) => isAuthValidMiddleware(options.getStore(), request, response, next)
    },
    (request, response) => {
      // Route to active source. If nothing is active yet, treat music as the default
      // (it's the original/primary view; once the user plays video, activeSource becomes video).
      const target = sourceCoordinator.getActiveSource() ?? "music";
      const body = request.body;

      if (target === "music") {
        const view = sourceCoordinator.getYtmView();
        if (!view) {
          response.code(503).send({ error: "Music view unavailable" });
          return;
        }
        switch (body.command) {
          case "play":
          case "pause":
          case "playPause":
          case "mute":
          case "unmute":
          case "volumeUp":
          case "volumeDown":
            view.webContents.send("remoteControl:execute", body.command);
            break;
          case "seekTo":
          case "setVolume":
            view.webContents.send("remoteControl:execute", body.command, body.data);
            break;
          case "seekRelative": {
            // Music's IPC doesn't support relative seek; compute absolute from the store.
            const state = playerStateStore.getState();
            const target = Math.max(0, (state.videoProgress ?? 0) + body.data);
            view.webContents.send("remoteControl:execute", "seekTo", target);
            break;
          }
        }
      } else {
        const view = sourceCoordinator.getYtVideoView();
        if (!view) {
          response.code(503).send({ error: "Video view unavailable" });
          return;
        }
        switch (body.command) {
          case "play":
          case "pause":
          case "playPause":
          case "mute":
          case "unmute":
          case "volumeUp":
          case "volumeDown":
            view.webContents.send("ytVideoView:execute", body.command);
            break;
          case "seekTo":
          case "seekRelative":
          case "setVolume":
            view.webContents.send("ytVideoView:execute", body.command, body.data);
            break;
        }
      }
      response.code(204).send();
    }
  );
};

export default CompanionServerAPIv1Playback;
