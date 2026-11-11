import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

const commandDefaults = (command: SlashCommandBuilder) =>
  command
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const commands = [
  commandDefaults(
    new SlashCommandBuilder()
      .setName("hello")
      .setDescription("Join your voice channel and start the looping video"),
  ),
  commandDefaults(
    new SlashCommandBuilder()
      .setName("goodbye")
      .setDescription("Stop the video stream and leave the voice channel"),
  ),
].map((command) => command.toJSON());
