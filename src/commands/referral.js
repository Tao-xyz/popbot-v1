'use strict';

const { SlashCommandBuilder } = require('discord.js');
const referralApi = require('../api/referral');
const walletStore = require('../utils/walletStore');
const { renderReferralCard } = require('../cards/referralCard');
const { safeHandler } = require('../utils/errors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('referral')
    .setDescription('Look up referral stats by wallet or code')
    .addStringOption((opt) => opt.setName('wallet').setDescription('Wallet address').setRequired(false))
    .addStringOption((opt) => opt.setName('code').setDescription('Referral code').setRequired(false)),

  execute: safeHandler(async (interaction) => {
    await interaction.deferReply();
    const wallet = interaction.options.getString('wallet');
    const code = interaction.options.getString('code');

    if (wallet) {
      const overview = await referralApi.getReferralByWallet(wallet);
      const attachment = await renderReferralCard(overview, { wallet });
      await interaction.editReply({ files: [attachment] });
      return;
    }
    if (code) {
      const overview = await referralApi.getReferralByCode(code);
      const attachment = await renderReferralCard(overview, { wallet: overview.codeInfo?.ownerAddress });
      await interaction.editReply({ files: [attachment] });
      return;
    }

    // No parameter — use the connected user's linked wallet if available.
    const linked = walletStore.getWallet(interaction.user.id);
    if (!linked) {
      await interaction.editReply(
        'Provide a `wallet` or `code`, or link your wallet first with `/wallet set`.'
      );
      return;
    }
    const overview = await referralApi.getReferralByWallet(linked);
    const attachment = await renderReferralCard(overview, { wallet: linked });
    await interaction.editReply({ files: [attachment] });
  }),
};