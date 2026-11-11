import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
} from "discord.js";
import { commands } from "./commands.js";
import { loadConfig } from "./config.js";
import { PlaybackController } from "./playback.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const playback = new PlaybackController(
    config.streamUserToken,
    config.videoUrl,
  );
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  const rest = new REST({ version: "10" }).setToken(config.botToken);
  await rest.put(Routes.applicationCommands(config.applicationId), {
    body: commands,
  });
  console.log("Registered /hello and /goodbye globally.");

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`DFS is online as ${readyClient.user.tag}.`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const explicitlyAllowed = config.allowedUserIds.has(interaction.user.id);
    const hasManageGuild = interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    );
    if (
      config.allowedUserIds.size > 0
        ? !explicitlyAllowed
        : !hasManageGuild
    ) {
      await interaction.reply({
        content: "You are not allowed to control this stream.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === "hello") {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const channel = member.voice.channel;
      if (!channel) {
        await interaction.reply({
          content: "Join a voice channel first.",
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      try {
        await playback.start(interaction.guildId, channel.id);
        await interaction.editReply(
          `Starting the looping video in **${channel.name}**.`,
        );
      } catch (error) {
        console.error("Failed to start playback.", error);
        await interaction.editReply(
          "Could not start the stream. Check the bot logs and account access.",
        );
      }
      return;
    }

    if (interaction.commandName === "goodbye") {
      await interaction.deferReply({ ephemeral: true });
      const stopped = await playback.stop();
      await interaction.editReply(
        stopped ? "Stopped the stream and left voice." : "Nothing is playing.",
      );
    }
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("Shutting down DFS...");
    await playback.destroy();
    client.destroy();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await client.login(config.botToken);
}

main().catch((error) => {
  console.error("DFS failed to start.", error);
  process.exitCode = 1;
});
