import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client as StreamClient } from "@lng2004/discord.js-selfbot-v13";
import { ffmpegPath } from "node-av/ffmpeg";
import { Streamer } from "../client/Streamer.js";
import { playStream } from "../media/index.js";
import { ensureMediaFile } from "./mediaSource.js";

type ActivePlayback = {
  abortController: AbortController;
  task: Promise<void>;
};

export class PlaybackController {
  readonly #streamer: Streamer;
  readonly #streamUserToken: string;
  readonly #videoUrl: string;
  #loginPromise?: Promise<unknown>;
  #active?: ActivePlayback;

  constructor(streamUserToken: string, videoUrl: string) {
    this.#streamUserToken = streamUserToken;
    this.#videoUrl = videoUrl;
    const streamClient = new StreamClient();

    // The selfbot client omits Gateway intents because user sessions do not use
    // them. When DFS reuses its official bot token, Discord requires the intents
    // field in Identify. Guilds + GuildVoiceStates are sufficient here.
    (
      streamClient.options.ws as typeof streamClient.options.ws & {
        intents: number;
      }
    ).intents = 129;
    this.#streamer = new Streamer(streamClient);
  }

  get isPlaying(): boolean {
    return Boolean(this.#active);
  }

  async #login(): Promise<void> {
    if (this.#streamer.client.user) return;
    this.#loginPromise ??= this.#streamer.client
      .login(this.#streamUserToken)
      .catch((error) => {
        this.#loginPromise = undefined;
        throw error;
      });
    await this.#loginPromise;
  }

  async start(guildId: string, channelId: string): Promise<void> {
    await this.stop();
    await this.#login();

    const abortController = new AbortController();
    let mediaPath: string;
    try {
      mediaPath = await ensureMediaFile(
        this.#videoUrl,
        abortController.signal,
      );
      await this.#streamer.joinVoice(guildId, channelId);
    } catch (error) {
      abortController.abort(error);
      this.#streamer.stopStream();
      this.#streamer.leaveVoice();
      throw error;
    }

    const task = this.#loop(mediaPath, abortController.signal).finally(() => {
      if (this.#active?.abortController === abortController) {
        this.#active = undefined;
      }
    });
    this.#active = { abortController, task };
  }

  async #loop(mediaPath: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const ffmpeg = spawn(
        ffmpegPath(),
        [
          "-hide_banner",
          "-loglevel",
          "warning",
          "-stream_loop",
          "-1",
          "-i",
          mediaPath,
          "-map",
          "0:v:0",
          "-map",
          "0:a:0?",
          "-vf",
          "scale=-2:720,fps=30,format=yuv420p",
          "-c:v",
          "libx264",
          "-preset",
          "superfast",
          "-tune",
          "zerolatency",
          "-b:v",
          "2500k",
          "-maxrate",
          "4000k",
          "-bufsize",
          "1250k",
          "-g",
          "30",
          "-keyint_min",
          "30",
          "-bf",
          "0",
          "-c:a",
          "libopus",
          "-b:a",
          "128k",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-f",
          "nut",
          "pipe:1",
        ],
        {
          signal,
          stdio: ["ignore", "pipe", "inherit"],
          windowsHide: true,
        },
      );
      ffmpeg.on("error", (error) => {
        if (!signal.aborted) console.error("FFmpeg process failed.", error);
      });

      try {
        await playStream(
          ffmpeg.stdout,
          this.#streamer,
          { type: "go-live", format: "nut" },
          signal,
        );
        if (!signal.aborted) {
          throw new Error("The FFmpeg loop ended unexpectedly.");
        }
      } catch (error) {
        if (signal.aborted) break;
        console.error("Stream iteration failed; retrying in 3 seconds.", error);
        this.#streamer.stopStream();
        await delay(3000, undefined, { signal }).catch(() => {});
      } finally {
        if (!ffmpeg.killed) ffmpeg.kill();
      }
    }
  }

  async stop(): Promise<boolean> {
    const active = this.#active;
    if (!active) return false;

    this.#active = undefined;
    active.abortController.abort(new Error("Playback stopped"));
    this.#streamer.stopStream();
    this.#streamer.leaveVoice();
    await active.task.catch(() => {});
    return true;
  }

  async destroy(): Promise<void> {
    await this.stop();
    this.#streamer.client.destroy();
  }
}
