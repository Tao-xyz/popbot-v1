'use strict';

const { SlashCommandBuilder } = require('discord.js');
const market = require('../api/market');
const { renderMarketCard } = require('../cards/marketCard');
const { safeHandler } = require('../utils/errors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('market')
    .setDescription('Show market info for a coin')
    .addStringOption((opt) =>
      opt.setName('coin').setDescription('Symbol, e.g. BTC or BTCUSDT').setRequired(true)
    ),

  execute: safeHandler(async (interaction) => {
    await interaction.deferReply();
    const raw = interaction.options.getString('coin', true).toUpperCase();
    const symbol = raw.endsWith('USDT') || raw.endsWith('USDC') ? raw : `${raw}USDT`;

    const ticker = await market.getMarketBySymbol(symbol);
    if (!ticker) {
      await interaction.editReply(`Couldn't find a market for **${raw}**.`);
      return;
    }

    const attachment = await renderMarketCard(ticker);
    await interaction.editReply({ files: [attachment] });
  }),
};
