'use strict';

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const config = require('./config');
const { safeHandler } = require('./utils/errors');

const positionCardSelect = require('./interactions/positionCardSelect');
// ordersPagination is only wired for the /orders command, which is
// currently disabled (see src/commands/_disabled/orders.js) — leaving it
// required but unused is harmless, but it's commented out here too so
// there's no stray "orders:" button handling while the command is off.
// const ordersPagination = require('./interactions/ordersPagination');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

// Component (button/select-menu) routers, checked in order.
const componentRouters = [positionCardSelect];

client.once('ready', () => {
  console.log(`Popdex bot online as ${client.user.tag} (network: ${config.popdex.network}).`);
});

client.on(
  'interactionCreate',
  safeHandler(async (interaction) => {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }

    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      const router = componentRouters.find((r) => r.matches(interaction.customId));
      if (router) await router.handle(interaction);
    }
  })
);

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

client.login(config.discord.token);
