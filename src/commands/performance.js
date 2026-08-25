'use strict';

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { newCanvas, loadAsset, desaturateImage, drawBackground, drawLogo, drawFooter, drawText, drawPill, roundRect, ensureFonts } = require('../cards/canvasUtils');
const fmt = require('../utils/format');
const { getMilestoneProgress } = require('../utils/milestones');
const account = require('../api/account');
const { resolveWallet } = require('../utils/resolveWallet');
const { safeHandler } = require('../utils/errors');

// Wider + taller than before so the added ACTIVE DAYS stat and the tier
// badge each get their own clear row instead of being squeezed into the
// old 740x520 layout (that's what was causing text to overlap).
const W = 680;
const H = 620;
const MARGIN = 32;

function activeDaysLabel(perf) {
  // Defensive clamp: activeDays should never exceed windowDays, but a
  // caller passing "8/7" suggests the underlying activeDays/windowDays
  // count (wherever perf is assembled — not in this file) has an
  // off-by-one, most likely an inclusive start+end date range for a
  // "last N days" window. Clamping here stops the visible symptom;
  // the real fix belongs in that date-range calculation.
  if (perf.windowDays) {
    const clamped = Math.min(perf.activeDays, perf.windowDays);
    return `${clamped}/${perf.windowDays} days`;
  }
  return `${perf.activeDays} days`;
}

async function renderPerformanceCard(perf) {
  const { fontFamily, fontFamilyBold } = ensureFonts();
  const { canvas, ctx } = newCanvas(W, H);
  const bg = await loadAsset('market.png');
  drawBackground(ctx, W, H, bg);

  await drawLogo(ctx, { x: MARGIN, y: 26, height: 56 });

  // getPerformance maps 30D→1M and 90D→6M since the portfolio endpoint
  // has no exact 30/90-day window (see account.js PERFORMANCE_WINDOW_MAP).
  // Surface that here instead of silently labeling mapped data as exact —
  // this is why volume/PnL/drawdown here can differ from a source that
  // computes a true 30/90-day figure.
  const windowLabel =
    perf.apiWindow && perf.apiWindow !== perf.window ? `${perf.window} (≈${perf.apiWindow})` : perf.window;

  drawText(ctx, `PERFORMANCE • ${windowLabel}`, MARGIN, 118, {
    font: `700 17px "${fontFamilyBold}"`,
    color: '#FFFFFF',
  });

  const pnl = Number(perf.portfolio?.intervalPnl ?? 0);
  const up = pnl >= 0;
  drawText(ctx, fmt.usd(pnl), MARGIN, 182, { font: `800 46px "${fontFamilyBold}"`, color: up ? '#5CF29C' : '#FF6B6B' });
  drawText(ctx, `${up ? '▲' : '▼'} ${fmt.pctFromFraction(perf.portfolio?.intervalReturn)} return`, MARGIN, 214, {
    font: `700 18px "${fontFamilyBold}"`,
    color: up ? '#5CF29C' : '#FF6B6B',
  });

  // Stat grid — 4 columns × 2 rows. 8 stats total (added AVG DAILY PNL)
  // fills the grid exactly, so no third row is needed and nothing
  // collides with the milestone bar below it.
  // AVG DAILY PNL — computed here rather than pulled from a guessed
  // field, since this file already has everything it needs: total PnL
  // for the window (intervalPnl) divided by the number of days in that
  // window. Uses windowDays (the period length) when available, falling
  // back to activeDays, then 1, so it never divides by zero.
  const pnlWindowDays = perf.windowDays || perf.activeDays || 1;
  const avgDailyPnl = pnl / pnlWindowDays;

  const stats = [
    ['TRADING VOLUME', fmt.usd(Number(perf.portfolio?.spotVolume || 0) + Number(perf.portfolio?.futuresVolume || 0), { compact: true })],
    ['TRADES', `${perf.trades}`],
    ['WIN RATE', perf.winRate !== null ? fmt.pct(perf.winRate, { signed: false }) : '—'],
    ['ACTIVE DAYS', activeDaysLabel(perf)],
    ['BEST TRADE', perf.bestTrade ? fmt.usd(perf.bestTrade.netProfit ?? perf.bestTrade.realizedPnl) : '—'],
    ['WORST TRADE', perf.worstTrade ? fmt.usd(perf.worstTrade.netProfit ?? perf.worstTrade.realizedPnl) : '—'],
    ['MAX DRAWDOWN' + (perf.maxDrawdownExact ? '' : ' (≈)'), fmt.pctFromFraction(perf.maxDrawdown, { signed: false })],
    ['AVG DAILY PNL', fmt.usd(avgDailyPnl)],
  ];
  const cols = 4;
  const colW = (W - MARGIN * 2) / cols;
  const gridTop = 270;
  const rowH = 96;
  // Labels are full white (were dimmed 0.6-opacity gray) and both label
  // + value are a step bigger per spec — this is also the ACTIVE DAYS /
  // TRADES stats the user flagged as hard to read.
  stats.forEach(([label, value], i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * colW;
    const y = gridTop + row * rowH;
    drawText(ctx, label, x, y, { font: `700 13px "${fontFamilyBold}"`, color: '#FFFFFF' });
    drawText(ctx, value, x, y + 30, { font: `800 24px "${fontFamilyBold}"`, color: '#FFFFFF' });
  });

  // Trading-tier badge — personal, lifetime volume only (never a global
  // leaderboard), independent of the 7D/30D/90D window picked above.
  const milestone = getMilestoneProgress(perf.lifetimeVolume);
  const tierY = gridTop + rowH * 2 + 20;

  drawText(ctx, 'TRADING TIER', MARGIN, tierY, { font: `700 13px "${fontFamilyBold}"`, color: '#FFFFFF' });
  const badgeText = milestone.reachedLabel ? `${milestone.reachedLabel} TRADER` : 'UNRANKED';
  drawPill(ctx, badgeText, {
    right: W - MARGIN,
    top: tierY - 24,
    font: `700 15px "${fontFamilyBold}"`,
    textColor: '#FFFFFF',
    bg: 'rgba(125, 249, 255, 0.18)',
  });

  // Milestone progress bar (lifetime volume toward the next tier above).
  // Kept well clear of the badge pill above it and the footer below it.
  const barY = tierY + 32;
  const barX = MARGIN;
  const barW = W - MARGIN * 2;
  const barH = 10;

  drawText(
    ctx,
    milestone.next
      ? `NEXT TIER — ${milestone.reachedLabel || '$0'} → ${milestone.nextLabel}`
      : 'ALL TIERS REACHED',
    barX,
    barY - 12,
    { font: `700 13px "${fontFamilyBold}"`, color: '#FFFFFF' }
  );

  ctx.save();
  roundRect(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fill();
  const fillW = Math.max(barH, barW * milestone.progress);
  const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  grad.addColorStop(0, '#7DF9FF');
  grad.addColorStop(1, '#5CF29C');
  roundRect(ctx, barX, barY, fillW, barH, barH / 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  drawFooter(ctx, W, H);
  const buffer = await canvas.encode('png');
  return new AttachmentBuilder(buffer, { name: 'performance-card.png' });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('performance')
    .setDescription('Show your trading performance card')
    .addStringOption((opt) =>
      opt
        .setName('window')
        .setDescription('Time window (defaults to 7D)')
        .setRequired(false)
        .addChoices(
          { name: '7 Days', value: '7D' },
          { name: '30 Days', value: '30D' },
          { name: 'All Time', value: 'ALL' }
        )
    )
    .addStringOption((opt) =>
      opt.setName('wallet').setDescription('Wallet address (defaults to your linked wallet)').setRequired(false)
    ),

  execute: safeHandler(async (interaction) => {
    await interaction.deferReply();
    const walletId = resolveWallet(interaction, interaction.options.getString('wallet'));
    const window = interaction.options.getString('window') || '7D';

    const perf = await account.getPerformance(walletId, window);
    const attachment = await renderPerformanceCard(perf);
    await interaction.editReply({ files: [attachment] });
  }),

  renderPerformanceCard,
};