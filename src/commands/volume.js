'use strict';

const { SlashCommandBuilder } = require('discord.js');
const market = require('../api/market');
const { renderVolumeCard } = require('../cards/volumeCard');
const { safeHandler } = require('../utils/errors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Show 24H trading volume')
    .addStringOption((opt) =>
      opt.setName('coin').setDescription('Symbol, e.g. BTC or BTCUSDT (omit for platform total)').setRequired(false)
    ),

  execute: safeHandler(async (interaction) => {
    await interaction.deferReply();
    const raw = interaction.options.getString('coin');

    if (!raw) {
      const data = await market.getVolume();
      const attachment = await renderVolumeCard(data);
      await interaction.editReply({ files: [attachment] });
      return;
    }

    const symbol = raw.toUpperCase().endsWith('USDT') || raw.toUpperCase().endsWith('USDC')
      ? raw.toUpperCase()
      : `${raw.toUpperCase()}USDT`;
    const ticker = await market.getVolumeBySymbol(symbol);
    if (!ticker) {
      await interaction.editReply(`Couldn't find a market for **${raw}**.`);
      return;
    }
    const attachment = await renderVolumeCard(ticker, { symbol: ticker.symbol });
    await interaction.editReply({ files: [attachment] });
  }),
};
