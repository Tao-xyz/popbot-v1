'use strict';

const { SlashCommandBuilder } = require('discord.js');
const vaultApi = require('../api/vault');
const { renderTvlOverviewCard, renderVaultDetailCard } = require('../cards/vaultCard');
const { safeHandler } = require('../utils/errors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tvl')
    .setDescription('Show TVL / vault info')
    .addStringOption((opt) =>
      opt.setName('vault').setDescription('Vault name or address (omit for platform overview)').setRequired(false)
    ),

  execute: safeHandler(async (interaction) => {
    await interaction.deferReply();
    const vaultName = interaction.options.getString('vault');

    if (!vaultName) {
      const data = await vaultApi.getTVL();
      const attachment = await renderTvlOverviewCard(data);
      await interaction.editReply({ files: [attachment] });
      return;
    }

    const activity = await vaultApi.getVaultActivity(vaultName);
    const attachment = await renderVaultDetailCard(activity);
    await interaction.editReply({ files: [attachment] });
  }),
};
