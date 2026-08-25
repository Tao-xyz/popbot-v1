'use strict';

const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const config = require('./config');

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

const commands = commandFiles.map((file) => {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const command = require(path.join(commandsPath, file));
  return command.data.toJSON();
});

const rest = new REST({ version: '10' }).setToken(config.discord.token);

const forceGlobal = process.argv.includes('--global');

// config.discord.guildId can be a single ID or a comma-separated list
// (e.g. "123,456") when the bot should register guild commands in more
// than one server. Split + trim so each ID is registered individually —
// Discord's API rejects a comma-joined string as a single guild_id.
const guildIds = (config.discord.guildId || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

(async () => {
  try {
    if (!forceGlobal && guildIds.length > 0) {
      for (const guildId of guildIds) {
        // eslint-disable-next-line no-await-in-loop
        await rest.put(Routes.applicationGuildCommands(config.discord.clientId, guildId), {
          body: commands,
        });
        console.log(`Registered ${commands.length} guild command(s) for guild ${guildId}.`);
      }
    } else {
      await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commands });
      console.log(`Registered ${commands.length} global command(s). These can take up to an hour to propagate.`);
    }
  } catch (err) {
    console.error('Failed to register commands:', err);
    process.exitCode = 1;
  }
})();