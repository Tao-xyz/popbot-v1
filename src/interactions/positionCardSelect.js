'use strict';

const cache = require('../utils/interactionCache');
const { designButtons } = require('../commands/positions');
const { renderStaticPositionCard } = require('../cards/positionsCard');
// Animated (MP4) position cards are disabled for now — every design is
// static. See src/cards/animatedPositionCard.js if this comes back later.
const { safeHandler } = require('../utils/errors');

const PICK_PREFIX = 'pos:pick:';
const DESIGN_PREFIX = 'pos:design:';

function matches(customId) {
  return customId.startsWith(PICK_PREFIX) || customId.startsWith(DESIGN_PREFIX);
}

const handleSelect = safeHandler(async (interaction) => {
  const token = interaction.customId.slice(PICK_PREFIX.length);
  const state = cache.get(token);
  if (!state) {
    await interaction.update({ content: 'This selection expired — run `/positions` again.', components: [] });
    return;
  }
  const posIndex = Number(interaction.values[0]);
  const position = state.positions[posIndex];
  await interaction.update({
    content: `**${position.symbol}** — choose a card design:`,
    components: [designButtons(token, posIndex)],
  });
});

const handleDesignButton = safeHandler(async (interaction) => {
  const [, , token, posIndexStr, designStr] = interaction.customId.split(':');
  const state = cache.get(token);
  if (!state) {
    await interaction.update({ content: 'This selection expired — run `/positions` again.', components: [] });
    return;
  }
  const position = state.positions[Number(posIndexStr)];
  const design = Number(designStr);

  await interaction.deferUpdate();

  // All designs are static for now — see commands/positions.js STATIC_DESIGNS.
  const attachment = await renderStaticPositionCard(position, state.referralCode, design);

  await interaction.editReply({ content: `**${position.symbol}**`, components: [], files: [attachment] });
});

async function handle(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(PICK_PREFIX)) {
    return handleSelect(interaction);
  }
  if (interaction.isButton() && interaction.customId.startsWith(DESIGN_PREFIX)) {
    return handleDesignButton(interaction);
  }
  return undefined;
}

module.exports = { matches, handle };
