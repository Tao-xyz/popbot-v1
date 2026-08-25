'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const account = require('../api/account');
const cache = require('../utils/interactionCache');
const fmt = require('../utils/format');
const config = require('../config');
const { safeHandler } = require('../utils/errors');

function formatOrderLine(o) {
  const entryTime = new Date(Number(o.createdAt)).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const exitTime = new Date(Number(o.updatedAt)).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  // PnL % derived from entry/exit price only (spec forbids dollar PnL / position size).
  const entry = Number(o.price || o.avgDealPrice || 0);
  const exit = Number(o.avgDealPrice || o.price || 0);
  const pnlPct = entry > 0 ? ((exit - entry) / entry) * (o.side === 'Buy' ? 1 : -1) : null;

  return (
    `**${o.symbol}** • ${o.side === 'Buy' ? 'Long' : 'Short'}\n` +
    `Entry \`${fmt.price(entry)}\` @ ${entryTime}  →  Exit \`${fmt.price(exit)}\` @ ${exitTime}\n` +
    `Leverage \`${o.symbolLeverage || '—'}\`  •  PnL \`${pnlPct !== null ? fmt.pct(pnlPct) : '—'}\`  •  ${o.status}`
  );
}

function buildOrdersMessage({ orders, token, page, hasNext }) {
  const embed = new EmbedBuilder()
    .setTitle('Order History')
    .setColor(0x7df9ff)
    .setDescription(orders.map(formatOrderLine).join('\n\n') || 'No orders on this page.')
    .setFooter({ text: `${config.branding.footer} • Page ${page + 1}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`orders:prev:${token}`)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`orders:next:${token}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasNext),
    new ButtonBuilder().setCustomId(`orders:refresh:${token}`).setLabel('Refresh').setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

const PREFIX = 'orders:';

function matches(customId) {
  return customId.startsWith(PREFIX);
}

/**
 * State shape cached per token: { walletId, cursorStack, page }
 * cursorStack[i] is the cursor used to fetch page i (cursorStack[0] is
 * always undefined — the first page has no cursor).
 */
const handle = safeHandler(async (interaction) => {
  const [, action, token] = interaction.customId.split(':');
  const state = cache.get(token);
  if (!state) {
    await interaction.update({ content: 'This view expired — run `/orders` again.', embeds: [], components: [] });
    return;
  }

  await interaction.deferUpdate();

  let targetPage = state.page;
  if (action === 'next') targetPage = state.page + 1;
  if (action === 'prev') targetPage = Math.max(0, state.page - 1);

  const cursorForTarget = state.cursorStack[targetPage];
  const { orders, cursor: nextCursor } = await account.getOrderHistory(state.walletId, {
    limit: 10,
    cursor: cursorForTarget,
  });

  const cursorStack = [...state.cursorStack];
  cursorStack[targetPage + 1] = nextCursor;

  cache.set(token, { walletId: state.walletId, cursorStack, page: targetPage });

  await interaction.editReply(buildOrdersMessage({ orders, token, page: targetPage, hasNext: Boolean(nextCursor) }));
});

module.exports = { buildOrdersMessage, matches, handle };
