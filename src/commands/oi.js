'use strict';

const { SlashCommandBuilder } = require('discord.js');
const market = require('../api/market');
const { renderOiCard } = require('../cards/oiCard');
const { safeHandler } = require('../utils/errors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('oi')
    .setDescription('Show open interest')
    .addStringOption((opt) =>
      opt.setName('coin').setDescription('Symbol, e.g. BTC or BTCUSDT (omit for platform overview)').setRequired(false)
    ),

  execute: safeHandler(async (interaction) => {
    await interaction.deferReply();
    const raw = interaction.options.getString('coin');

    if (!raw) {
      const data = await market.getOpenInterest();
      const attachment = await renderOiCard(data);
      await interaction.editReply({ files: [attachment] });
      return;
    }

    const symbol = raw.toUpperCase().endsWith('USDT') || raw.toUpperCase().endsWith('USDC')
      ? raw.toUpperCase()
      : `${raw.toUpperCase()}USDT`;
    const row = await market.getOpenInterestBySymbol(symbol);
    if (!row) {
      await interaction.editReply(`Couldn't find open interest for **${raw}**.`);
      return;
    }
    const attachment = await renderOiCard(row, { symbol: row.symbol });
    await interaction.editReply({ files: [attachment] });
  }),
};
