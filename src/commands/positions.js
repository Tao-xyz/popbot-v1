'use strict';

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const account = require('../api/account');
const referralApi = require('../api/referral');
const { resolveWallet } = require('../utils/resolveWallet');
const { safeHandler } = require('../utils/errors');
const cache = require('../utils/interactionCache');

async function tryGetReferralCode(walletId) {
  try {
    const overview = await referralApi.getReferralByWallet(walletId);
    return overview?.referralCode?.referralCode || null;
  } catch {
    return null;
  }
}

// All position card designs are static (no MP4/animated cards behind
// them for now). STATIC_DESIGNS maps each design number to its button
// label and its assets/position_N.png artwork — add a new entry here
// (with a matching assets/position_N.png) any time a new static design
// is added; the buttons and the renderer both pick it up automatically.
const STATIC_DESIGNS = [
  { design: 1, label: 'Static Position Card 1' },
  { design: 2, label: 'Static Position Card 2' },
];

function designButtons(token, posIndex) {
  return new ActionRowBuilder().addComponents(
    STATIC_DESIGNS.map(({ design, label }) =>
      new ButtonBuilder()
        .setCustomId(`pos:design:${token}:${posIndex}:${design}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Secondary)
    )
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('positions')
    .setDescription('Show your currently open positions')
    .addStringOption((opt) =>
      opt.setName('wallet').setDescription('Wallet address (defaults to your linked wallet)').setRequired(false)
    ),

  execute: safeHandler(async (interaction) => {
    await interaction.deferReply();
    const walletId = resolveWallet(interaction, interaction.options.getString('wallet'));

    const positions = await account.getOpenPositions(walletId);
    if (positions.length === 0) {
      await interaction.editReply('No open positions right now.');
      return;
    }

    const referralCode = await tryGetReferralCode(walletId);
    const token = cache.put({ positions, referralCode });

    if (positions.length === 1) {
      await interaction.editReply({
        content: `**${positions[0].symbol}** — choose a card design:`,
        components: [designButtons(token, 0)],
      });
      return;
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`pos:pick:${token}`)
      .setPlaceholder('Choose a position')
      .addOptions(
        positions.slice(0, 25).map((p, i) => ({
          label: `${p.symbol} • ${p.positionSide} • ${p.symbolLeverage}x`,
          value: String(i),
        }))
      );

    await interaction.editReply({
      content: `You have ${positions.length} open positions — pick one:`,
      components: [new ActionRowBuilder().addComponents(menu)],
    });
  }),
};

module.exports.designButtons = designButtons;
module.exports.STATIC_DESIGNS = STATIC_DESIGNS;
