'use strict';

const { SlashCommandBuilder } = require('discord.js');
const market = require('../api/market');
const { renderPulseCard } = require('../cards/pulseCard');
const { safeHandler } = require('../utils/errors');

module.exports = {
  data: new SlashCommandBuilder().setName('pulse').setDescription('Compact real-time market snapshot'),

  execute: safeHandler(async (interaction) => {
    await interaction.deferReply();
    const pulse = await market.getPulse();
    if (!pulse) {
      await interaction.editReply('No market data available right now.');
      return;
    }
    const attachment = await renderPulseCard(pulse);
    await interaction.editReply({ files: [attachment] });
  }),
};
