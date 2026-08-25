'use strict';

// DISABLED FOR NOW — moved out of src/commands/ so it isn't loaded or
// registered as a slash command. index.js and deploy-commands.js only
// scan src/commands/ (not this _disabled/ subfolder), so /orders simply
// won't exist until this file is moved back up a directory. Nothing else
// needs to change to re-enable it — just `mv` it back to src/commands/.

const { SlashCommandBuilder } = require('discord.js');
const account = require('../api/account');
const { resolveWallet } = require('../utils/resolveWallet');
const { safeHandler } = require('../utils/errors');
const { buildOrdersMessage } = require('../interactions/ordersPagination');
const cache = require('../utils/interactionCache');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('orders')
    .setDescription('Show your recent completed orders')
    .addStringOption((opt) =>
      opt.setName('wallet').setDescription('Wallet address (defaults to your linked wallet)').setRequired(false)
    ),

  execute: safeHandler(async (interaction) => {
    await interaction.deferReply();
    const walletId = resolveWallet(interaction, interaction.options.getString('wallet'));

    const { orders, cursor } = await account.getOrderHistory(walletId, { limit: 10 });
    if (orders.length === 0) {
      await interaction.editReply('No completed orders found.');
      return;
    }

    const token = cache.put({ walletId, cursorStack: [undefined, cursor], page: 0 });
    const message = buildOrdersMessage({ orders, token, page: 0, hasNext: Boolean(cursor) });
    await interaction.editReply(message);
  }),
};
