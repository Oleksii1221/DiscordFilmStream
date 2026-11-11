import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { arch, platform } from "node:os";
import { basename, join, resolve } from "node:path";
import { ffmpegPath } from "node-av/ffmpeg";

const YT_DLP_VERSION = "2026.10.26";
const WINDOWS_X64_SHA256 =
  "f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d";
const WINDOWS_X64_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp.exe`;

const inFlight = new Map<string, Promise<string>>();

export function extractYouTubeVideoId(input: string): string {
  const url = new URL(input);
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");

  let videoId: string | null = null;
  if (hostname === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (hostname === "youtube.com" || hostname === "m.youtube.com") {
    videoId = url.searchParams.get("v");
  }

  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    throw new Error("DFS_VIDEO_URL must be a valid YouTube video URL.");
  }
  return videoId;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function verifySha256(path: string, expected: string): Promise<void> {
  const actual = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  if (actual !== expected) {
    throw new Error(`Checksum verification failed for ${basename(path)}.`);
  }
}

async function downloadPinnedWindowsYtDlp(cacheDir: string): Promise<string> {
  const toolDir = join(cacheDir, "tools");
  const destination = join(toolDir, "yt-dlp.exe");
  await mkdir(toolDir, { recursive: true });

  if (await fileExists(destination)) {
    await verifySha256(destination, WINDOWS_X64_SHA256);
    return destination;
  }

  const response = await fetch(WINDOWS_X64_URL, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to download yt-dlp: HTTP ${response.status}.`);
  }

  const temporary = `${destination}.download`;
  await writeFile(temporary, Buffer.from(await response.arrayBuffer()));
  try {
    await verifySha256(temporary, WINDOWS_X64_SHA256);
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return destination;
}

async function resolveYtDlp(cacheDir: string): Promise<string> {
  const override = process.env.YT_DLP_PATH?.trim();
  if (override) return override;

  if (platform() === "win32" && arch() === "x64") {
    return downloadPinnedWindowsYtDlp(cacheDir);
  }

  return "yt-dlp";
}

async function run(
  executable: string,
  args: string[],
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      signal,
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, childSignal) => {
      if (code === 0) resolvePromise();
      else {
        rejectPromise(
          new Error(
            `${basename(executable)} failed with ${
              childSignal ? `signal ${childSignal}` : `exit code ${code}`
            }.`,
          ),
        );
      }
    });
  });
}

async function downloadMedia(
  videoUrl: string,
  videoId: string,
  signal?: AbortSignal,
): Promise<string> {
  const cacheDir = resolve(process.env.DFS_CACHE_DIR?.trim() || ".cache");
  const mediaDir = join(cacheDir, "media");
  const destination = join(mediaDir, `${videoId}.mp4`);
  await mkdir(mediaDir, { recursive: true });

  if (await fileExists(destination)) {
    const info = await stat(destination);
    if (info.size > 0) return destination;
    await unlink(destination);
  }

  const temporary = join(mediaDir, `${videoId}.download.mp4`);
  await unlink(temporary).catch(() => {});
  const ytDlp = await resolveYtDlp(cacheDir);

  await run(
    ytDlp,
    [
      "--no-playlist",
      "--no-progress",
      "--force-overwrites",
      "--js-runtimes",
      `node:${process.execPath}`,
      "--ffmpeg-location",
      ffmpegPath(),
      "--format",
      "bv*[vcodec^=avc1]+ba/b",
      "--merge-output-format",
      "mp4",
      "--output",
      temporary,
      videoUrl,
    ],
    signal,
  );

  const result = await stat(temporary).catch(() => null);
  if (!result || result.size === 0) {
    throw new Error("yt-dlp completed without producing the media file.");
  }
  await rename(temporary, destination);
  return destination;
}

export function ensureMediaFile(
  videoUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const videoId = extractYouTubeVideoId(videoUrl);
  const existing = inFlight.get(videoId);
  if (existing) return existing;

  const task = downloadMedia(videoUrl, videoId, signal).finally(() => {
    inFlight.delete(videoId);
  });
  inFlight.set(videoId, task);
  return task;
}
