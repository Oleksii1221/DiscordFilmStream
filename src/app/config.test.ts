import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";

const originalEnvironment = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnvironment };
});

test("reuses the bot token when no stream token is configured", () => {
  process.env.DISCORD_APPLICATION_ID = "1570088256945524776";
  process.env.DISCORD_BOT_TOKEN = "bot-token";
  process.env.DISCORD_STREAM_USER_TOKEN = "";

  const config = loadConfig();

  assert.equal(config.streamUserToken, "bot-token");
});

test("prefers an explicit stream user token", () => {
  process.env.DISCORD_APPLICATION_ID = "1570088256945524776";
  process.env.DISCORD_BOT_TOKEN = "bot-token";
  process.env.DISCORD_STREAM_USER_TOKEN = "stream-token";

  const config = loadConfig();

  assert.equal(config.streamUserToken, "stream-token");
});
