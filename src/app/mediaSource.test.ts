import assert from "node:assert/strict";
import test from "node:test";
import { extractYouTubeVideoId } from "./mediaSource.js";

test("extracts a standard YouTube video id", () => {
  assert.equal(
    extractYouTubeVideoId("https://www.youtube.com/watch?v=GBIIQ0kP15E"),
    "GBIIQ0kP15E",
  );
});

test("extracts a short YouTube video id", () => {
  assert.equal(
    extractYouTubeVideoId("https://youtu.be/GBIIQ0kP15E"),
    "GBIIQ0kP15E",
  );
});

test("rejects non-YouTube URLs", () => {
  assert.throws(() => extractYouTubeVideoId("https://example.com/video"));
});
