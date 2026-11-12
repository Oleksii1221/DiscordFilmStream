import "dotenv/config";

export type AppConfig = {
  applicationId: string;
  botToken: string;
  streamUserToken: string;
  videoUrl: string;
  allowedUserIds: ReadonlySet<string>;
};

function requireSecret(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required. Copy .env.example to .env and set the secret locally.`,
    );
  }
  return value;
}

function requireSnowflake(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!value || !/^\d{17,20}$/.test(value)) {
    throw new Error(`${name} must be a valid Discord snowflake.`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  const botToken = requireSecret("DISCORD_BOT_TOKEN");
  return {
    applicationId: requireSnowflake(
      "DISCORD_APPLICATION_ID",
      "1570088256945524776",
    ),
    botToken,
    streamUserToken:
      process.env.DISCORD_STREAM_USER_TOKEN?.trim() || botToken,
    videoUrl:
      process.env.DFS_VIDEO_URL?.trim() ||
      "https://www.youtube.com/watch?v=GBIIQ0kP15E",
    allowedUserIds: new Set(
      (process.env.DFS_ALLOWED_USER_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  };
}
