'use strict';

const { AttachmentBuilder } = require('discord.js');
const { newCanvas, loadAsset, drawBackground, drawLogo, drawFooter, drawText, roundRect, ensureFonts } = require('./canvasUtils');
const fmt = require('../utils/format');

const W = 720;
const MARGIN = 28;

/**
 * Platform-wide TVL overview card. Height grew from a fixed 480 to 560 —
 * with up to 5 vault rows at the new, wider row spacing the list ran past
 * the old canvas height and into/under the footer.
 */
async function renderTvlOverviewCard(data) {
  const { fontFamily, fontFamilyBold } = ensureFonts();
  const H = 560;
  const { canvas, ctx } = newCanvas(W, H);
  const bg = await loadAsset('vault.png');
  drawBackground(ctx, W, H, bg);
  await drawLogo(ctx, { x: MARGIN, y: 26, height: 56 });

  drawText(ctx, 'PLATFORM TVL', MARGIN, 118, { font: `700 16px "${fontFamilyBold}"`, color: '#FFFFFF' });
  drawText(ctx, fmt.usd(data.totalTvl, { compact: true }), MARGIN, 182, {
    font: `800 46px "${fontFamilyBold}"`,
    color: '#FFFFFF',
  });
  drawText(ctx, `${data.vaultCount} active vaults`, MARGIN, 214, {
    font: `600 15px "${fontFamily}"`,
    color: '#FFFFFF',
  });

  // "TOP VAULTS" label and row #1 previously sat only 28px apart (268 →
  // 296), which read as overlapping once the row's own 38px-tall pill
  // background was drawn behind it. Pushed the label down and the list
  // start further down to give real clearance, label now full white.
  drawText(ctx, 'TOP VAULTS', MARGIN, 258, { font: `700 13px "${fontFamilyBold}"`, color: '#FFFFFF' });
  const listTop = 306;
  const rowH = 50;
  data.topVaults.forEach((v, i) => {
    const y = listTop + i * rowH;
    ctx.save();
    roundRect(ctx, MARGIN - 8, y - 28, W - (MARGIN - 8) * 2, 38, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.restore();
    drawText(ctx, `${i + 1}.  ${v.name}`, MARGIN + 6, y, { font: `700 16px "${fontFamilyBold}"`, color: '#FFFFFF' });
    drawText(ctx, fmt.usd(v.totalEquity, { compact: true }), W - MARGIN - 6, y, {
      font: `700 16px "${fontFamilyBold}"`,
      align: 'right',
      color: '#FFFFFF',
    });
  });

  drawFooter(ctx, W, H);
  const buffer = await canvas.encode('png');
  return new AttachmentBuilder(buffer, { name: 'tvl-overview-card.png' });
}

/**
 * Dedicated single-vault card: name, current TVL, TVL change, deposits,
 * withdrawals, and recent vault activity. Intentionally distinct layout
 * from the Market Card.
 */
async function renderVaultDetailCard(activity) {
  const { fontFamily, fontFamilyBold } = ensureFonts();
  // Was a fixed 480 — the last "Recent Activity" row could land at y=494,
  // past the canvas and right under the footer. 540 gives it clearance.
  const H = 540;
  const { canvas, ctx } = newCanvas(W, H);
  const bg = await loadAsset('vault.png');
  drawBackground(ctx, W, H, bg);
  await drawLogo(ctx, { x: MARGIN, y: 26, height: 56 });

  const { meta, depositTotal, withdrawTotal, recentActivity } = activity;

  drawText(ctx, meta.name, MARGIN, 118, { font: `800 24px "${fontFamilyBold}"`, color: '#FFFFFF' });
  drawText(ctx, `Leader ${fmt.shortAddr(meta.leader)}`, MARGIN, 142, {
    font: `600 13px "${fontFamily}"`,
    color: '#FFFFFF',
  });

  drawText(ctx, fmt.usd(meta.totalEquity, { compact: true }), MARGIN, 202, {
    font: `800 40px "${fontFamilyBold}"`,
    color: '#FFFFFF',
  });
  drawText(ctx, 'CURRENT TVL', MARGIN, 228, { font: `700 13px "${fontFamilyBold}"`, color: '#FFFFFF' });

  const stats = [
    ['NAV / SHARE', fmt.price(meta.nav)],
    ['APR', fmt.pctFromFraction(meta.apr, { signed: false })],
    ['DEPOSITS (recent)', fmt.usd(depositTotal, { compact: true })],
    ['WITHDRAWALS (recent)', fmt.usd(withdrawTotal, { compact: true })],
  ];
  const colW = (W - MARGIN * 2) / 2;
  const gridTop = 278;
  const rowH = 68;
  stats.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MARGIN + col * colW;
    const y = gridTop + row * rowH;
    drawText(ctx, label, x, y, { font: `700 13px "${fontFamilyBold}"`, color: '#FFFFFF' });
    drawText(ctx, value, x, y + 26, { font: `700 20px "${fontFamilyBold}"`, color: '#FFFFFF' });
  });

  drawText(ctx, 'RECENT ACTIVITY', MARGIN, 424, { font: `700 13px "${fontFamilyBold}"`, color: '#FFFFFF' });
  recentActivity.slice(0, 3).forEach((a, i) => {
    const y = 452 + i * 24;
    const label = a.type === 'VaultDeposit' ? 'Deposit' : 'Withdraw';
    drawText(ctx, `${label} • ${fmt.usd(a.amount, { compact: true })} • ${fmt.timeAgo(a.createdAt)}`, MARGIN, y, {
      font: `600 14px "${fontFamily}"`,
      color: '#FFFFFF',
    });
  });

  drawFooter(ctx, W, H);
  const buffer = await canvas.encode('png');
  return new AttachmentBuilder(buffer, { name: 'vault-card.png' });
}

module.exports = { renderTvlOverviewCard, renderVaultDetailCard };