'use strict';

const { AttachmentBuilder } = require('discord.js');
const { newCanvas, loadAsset, drawBackground, drawLogo, drawFooter, drawText, ensureFonts } = require('./canvasUtils');
const fmt = require('../utils/format');

const W = 680;
const MARGIN = 28;

/**
 * Two shapes:
 *  - platform-wide: { totalOi, top5: [...] }
 *  - single symbol: { symbol, openInterest }
 */
async function renderOiCard(data, { symbol } = {}) {
  const { fontFamily, fontFamilyBold } = ensureFonts();
  // Platform card grew from 520 to 560 to fit the extra 24H-change line
  // and the wider gap above the TOP 5 list without crowding the footer.
  const height = symbol ? 320 : 560;
  const { canvas, ctx } = newCanvas(W, height);
  const bg = await loadAsset('market.png');
  drawBackground(ctx, W, height, bg);

  await drawLogo(ctx, { x: MARGIN, y: 24, height: 50 });

  if (symbol) {
    drawText(ctx, `${symbol} • OPEN INTEREST`, MARGIN, 106, {
      font: `700 16px "${fontFamilyBold}"`,
      color: '#FFFFFF',
    });
    drawText(ctx, fmt.compact(data.openInterest), MARGIN, 178, {
      font: `800 44px "${fontFamilyBold}"`,
      color: '#FFFFFF',
    });
    drawText(ctx, `${symbol.replace(/USDT?$|USDC$/, '')} contracts`, MARGIN, 210, {
      font: `600 16px "${fontFamily}"`,
      color: '#FFFFFF',
    });
    // Real 24H change for this symbol's OI (see metricHistory.js) — "—"
    // until a snapshot from ~24h ago is on file, never fabricated.
    if (data.change24h !== null && data.change24h !== undefined) {
      const up = data.change24h >= 0;
      drawText(ctx, `${up ? '▲' : '▼'} ${fmt.pctFromFraction(data.change24h)} OI 24H`, MARGIN, 240, {
        font: `600 16px "${fontFamily}"`,
        color: up ? '#5CF29C' : '#FF6B6B',
      });
    }
  } else {
    drawText(ctx, 'PLATFORM OPEN INTEREST', MARGIN, 106, {
      font: `700 16px "${fontFamilyBold}"`,
      color: '#FFFFFF',
    });
    drawText(ctx, fmt.compact(data.totalOi), MARGIN, 174, {
      font: `800 44px "${fontFamilyBold}"`,
      color: '#FFFFFF',
    });
    drawText(ctx, 'Total open interest across all markets', MARGIN, 206, {
      font: `600 14px "${fontFamily}"`,
      color: '#FFFFFF',
    });
    // Real 24H change in platform-wide OI (see metricHistory.js) — "—"
    // until a snapshot from ~24h ago is on file, never fabricated.
    if (data.change24h !== null && data.change24h !== undefined) {
      const up = data.change24h >= 0;
      drawText(ctx, `${up ? '▲' : '▼'} ${fmt.pctFromFraction(data.change24h)} vs. 24H ago`, MARGIN, 236, {
        font: `600 15px "${fontFamily}"`,
        color: up ? '#5CF29C' : '#FF6B6B',
      });
    }

    // Was 264/306 — the "TOP 5 MARKETS BY OI" label and the "1." first
    // row sat only ~42px apart with the label barely dimmer than the
    // list text, so they visually ran together. Pushed the label down
    // and the list start further down to give it real clearance, and the
    // label is now full white to match the rest of the card.
    drawText(ctx, 'TOP 5 MARKETS BY OI', MARGIN, 280, {
      font: `700 13px "${fontFamilyBold}"`,
      color: '#FFFFFF',
    });
    const listTop = 328;
    const rowH = 46;
    data.top5.forEach((row, i) => {
      const y = listTop + i * rowH;
      drawText(ctx, `${i + 1}.  ${row.symbol}`, MARGIN, y, { font: `700 19px "${fontFamilyBold}"`, color: '#FFFFFF' });
      drawText(ctx, fmt.compact(row.openInterest), W - MARGIN, y, {
        font: `700 19px "${fontFamilyBold}"`,
        align: 'right',
        color: '#FFFFFF',
      });
    });
  }

  drawFooter(ctx, W, height);
  const buffer = await canvas.encode('png');
  return new AttachmentBuilder(buffer, { name: 'oi-card.png' });
}

module.exports = { renderOiCard };