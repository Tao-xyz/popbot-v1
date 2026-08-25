require("dotenv").config();
const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");

const commands = [];
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Deploying ${commands.length} slash commands...`);

    // GUILD_ID in .env can be a single ID or a comma-separated list (e.g.
    // "123,456") for deploying to multiple servers at once. Discord's API
    // rejects a comma-joined string as a single guild_id (that's the
    // NUMBER_TYPE_COERCE error), so it's split and deployed once per guild
    // instead of passed through as-is.
    //
    // For a global deploy (available in every server, but takes up to ~1
    // hour to propagate) instead of guild-scoped, swap the loop below for:
    //   await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    const guildIds = (process.env.GUILD_ID || "")
      .split(",")
      .map(id => id.trim())
      .filter(Boolean);

    if (guildIds.length === 0) {
      throw new Error("GUILD_ID is not set in .env");
    }

    for (const guildId of guildIds) {
      const data = await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
        { body: commands }
      );
      console.log(`Successfully deployed ${data.length} commands to guild ${guildId}.`);
    }
  } catch (err) {
    console.error(err);
  }
})();