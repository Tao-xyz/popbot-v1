'use strict';

const { SlashCommandBuilder } = require('discord.js');
const walletStore = require('../utils/walletStore');
const fmt = require('../utils/format');
const { safeHandler } = require('../utils/errors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wallet')
    .setDescription('Link the wallet Popdex commands use for you')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Link a wallet address to your Discord account')
        .addStringOption((opt) => opt.setName('address').setDescription('0x… wallet address').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('show').setDescription('Show your currently linked wallet'))
    .addSubcommand((sub) => sub.setName('clear').setDescription('Unlink your wallet')),

  execute: safeHandler(async (interaction) => {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const address = interaction.options.getString('address', true);
      walletStore.setWallet(interaction.user.id, address);
      await interaction.reply({ content: `Linked wallet \`${fmt.shortAddr(address)}\`.`, ephemeral: true });
      return;
    }

    if (sub === 'show') {
      const address = walletStore.getWallet(interaction.user.id);
      await interaction.reply({
        content: address ? `Linked wallet: \`${address}\`` : 'No wallet linked yet — use `/wallet set`.',
        ephemeral: true,
      });
      return;
    }

    // clear
    walletStore.clearWallet(interaction.user.id);
    await interaction.reply({ content: 'Wallet unlinked.', ephemeral: true });
  }),
};
