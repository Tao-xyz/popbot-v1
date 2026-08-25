'use strict';

const { AttachmentBuilder } = require('discord.js');
const {
  newCanvas,
  loadAsset,
  drawBackground,
  drawLogo,
  drawFrame,
  drawFooter,
  drawText,
  ensureFonts,
} = require('./canvasUtils');
const fmt = require('../utils/format');
const LAYOUT = require('./positionCardLayout');

// 2:1 card. To resize, change W only — everything else derives from
// LAYOUT (positionCardLayout.js), which is shared with
// animatedPositionCard.js so both stay pixel-in-sync.
const W = 800;
const H = Math.round(W / LAYOUT.aspectRatio);
const MARGIN = Math.round(W * LAYOUT.margin);

const LEFT_W = Math.round(W * LAYOUT.panelWidthFrac);
const TEXT_RIGHT_EDGE = LEFT_W - 16;

/**
 * Renders one of the two static position card designs. design is 1 or 2,
 * mapping to assets/position_1.png / position_2.png (the right-side
 * artwork). No position size, wallet balance, or dollar-value PnL is ever
 * drawn — only the fields the spec allows.
 */
async function renderStaticPositionCard(position, referralCode, design = 1) {
  const { fontFamily, fontFamilyBold } = ensureFonts();
  const { canvas, ctx } = newCanvas(W, H);

  // 1) Full-bleed artwork across the whole card (fills the right 40%).
  const bg = await loadAsset(`position_${design}.png`);
  drawBackground(ctx, W, H, bg);

  // 2) Logo — its own row, generously sized.
  await drawLogo(ctx, {
    x: MARGIN,
    y: Math.round(H * LAYOUT.logo.y),
    height: Math.round(H * LAYOUT.logo.heightFrac),
  });

  const isLong = position.positionSide === 'Long';
  const sideColor = isLong ? '#5CF29C' : '#FF6B6B';

  // Clear gap under the logo before the symbol starts (LAYOUT.symbol.y).
  drawText(ctx, position.symbol, MARGIN, Math.round(H * LAYOUT.symbol.y), {
    font: `800 ${Math.round(H * LAYOUT.symbol.size)}px "${fontFamilyBold}"`,
  });
  // Side + leverage TOGETHER on one line — "LONG • 20x". Leverage's only
  // other candidate spot (the grid) is now used for the referral code
  // instead, so it appears exactly once, right here.
  drawText(ctx, `${isLong ? 'LONG' : 'SHORT'}  •  ${position.symbolLeverage}x`, MARGIN, Math.round(H * LAYOUT.sideLine.y), {
    font: `700 ${Math.round(H * LAYOUT.sideLine.size)}px "${fontFamilyBold}"`,
    color: sideColor,
  });

  const pnlPct = Number(position.avgOpenPrice) > 0
    ? ((Number(position.markPrice) - Number(position.avgOpenPrice)) / Number(position.avgOpenPrice)) *
      (isLong ? 1 : -1) *
      Number(position.symbolLeverage || 1)
    : null;
  const pnlUp = pnlPct !== null && pnlPct >= 0;

  drawText(ctx, pnlPct !== null ? fmt.pct(pnlPct) : '—', MARGIN, Math.round(H * LAYOUT.pnl.y), {
    font: `800 ${Math.round(H * LAYOUT.pnl.size)}px "${fontFamilyBold}"`,
    color: pnlUp ? '#5CF29C' : '#FF6B6B',
  });
  drawText(ctx, 'UNREALIZED PnL %', MARGIN, Math.round(H * LAYOUT.pnlLabel.y), {
    font: `400 ${Math.round(H * LAYOUT.pnlLabel.size)}px "${fontFamily}"`,
    color: '#FFFFFF',
  });

  // 2×2 grid: ENTRY, MARKET, LIQ always. REFERRAL CODE takes the 4th cell
  // (previously LEVERAGE, which now lives on the side line above) — only
  // added when a referral code actually exists, never fabricated.
  const rows = [
    ['ENTRY PRICE', fmt.price(position.avgOpenPrice)],
    ['MARKET PRICE', fmt.price(position.markPrice)],
    ['LIQ. PRICE', fmt.price(position.liquidationPrice)],
  ];
  if (referralCode) rows.push(['REFERRAL CODE', referralCode]);

  const usableWidth = TEXT_RIGHT_EDGE - MARGIN;
  const colW = usableWidth / LAYOUT.grid.cols;
  const gridTop = Math.round(H * LAYOUT.grid.top);
  const rowH = Math.round(H * LAYOUT.grid.rowH);
  const valueOffset = Math.round(H * LAYOUT.grid.valueOffset);
  rows.forEach(([label, value], i) => {
    const col = i % LAYOUT.grid.cols;
    const row = Math.floor(i / LAYOUT.grid.cols);
    const x = MARGIN + col * colW;
    const y = gridTop + row * rowH;
    const isReferral = label === 'REFERRAL CODE';
    // Headings (ENTRY PRICE / MARKET PRICE / LIQ. PRICE / REFERRAL CODE) are
    // full solid white and regular (non-bold) weight — only the values
    // below them are bold.
    drawText(ctx, label, x, y, {
      font: `400 ${Math.round(H * LAYOUT.grid.labelSize)}px "${fontFamily}"`,
      color: '#FFFFFF',
    });
    // Referral is drawn larger than the other grid values so it stands
    // out as a proper field instead of a squeezed-in footnote. Value is
    // now plain white (was cyan) to match the "white tone" spec.
    const valueSize = isReferral ? LAYOUT.grid.referralValueSize : LAYOUT.grid.valueSize;
    drawText(ctx, value, x, y + valueOffset, {
      font: `700 ${Math.round(H * valueSize)}px "${fontFamilyBold}"`,
      color: '#FFFFFF',
    });
  });

  drawFooter(ctx, W, H);

  // 3) Frame — drawn last so it sits crisply on top of everything else.
  drawFrame(ctx, W, H, LAYOUT.frame);

  const buffer = await canvas.encode('png');
  return new AttachmentBuilder(buffer, { name: `position-card-${design}.png` });
}

module.exports = { renderStaticPositionCard };