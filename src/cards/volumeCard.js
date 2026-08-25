'use strict';

const { AttachmentBuilder } = require('discord.js');
const { newCanvas, loadAsset, drawBackground, drawLogo, drawFooter, drawText, ensureFonts } = require('./canvasUtils');
const fmt = require('../utils/format');

const W = 620;
const H = 320;
const MARGIN = 28;

/**
 * Two shapes:
 *  - platform-wide: { total24h, marketCount }
 *  - single symbol: a ticker object (uses turnover24h + price24hPcnt)
 */
async function renderVolumeCard(data, { symbol } = {}) {
  const { fontFamily, fontFamilyBold } = ensureFonts();
  const { canvas, ctx } = newCanvas(W, H);
  const bg = await loadAsset('market.png');
  drawBackground(ctx, W, H, bg);

  await drawLogo(ctx, { x: MARGIN, y: 24, height: 52 });

  if (symbol) {
    drawText(ctx, `${symbol} • 24H VOLUME`, MARGIN, 110, {
      font: `700 15px "${fontFamilyBold}"`,
      color: '#FFFFFF',
    });
    drawText(ctx, fmt.usd(data.turnover24h, { compact: true }), MARGIN, 178, {
      font: `800 46px "${fontFamilyBold}"`,
      color: '#FFFFFF',
    });
    const priceUp = Number(data.price24hPcnt) >= 0;
    drawText(ctx, `${priceUp ? '▲' : '▼'} ${fmt.pctFromFraction(data.price24hPcnt)} price 24H`, MARGIN, 214, {
      font: `600 18px "${fontFamily}"`,
      color: priceUp ? '#5CF29C' : '#FF6B6B',
    });
    // Volume itself moving up/down over the last 24H (distinct from the
    // price change above) — derived from our own snapshots since the API
    // has no rolling volume-delta feed. Shows "—" until enough history
    // has been collected, never a fabricated figure.
    if (data.volumeChange24h !== null && data.volumeChange24h !== undefined) {
      const volUp = data.volumeChange24h >= 0;
      drawText(ctx, `${volUp ? '▲' : '▼'} ${fmt.pctFromFraction(data.volumeChange24h)} volume 24H`, MARGIN, 244, {
        font: `600 16px "${fontFamily}"`,
        color: volUp ? '#5CF29C' : '#FF6B6B',
      });
    }
  } else {
    drawText(ctx, 'PLATFORM 24H VOLUME', MARGIN, 110, {
      font: `700 15px "${fontFamilyBold}"`,
      color: '#FFFFFF',
    });
    drawText(ctx, fmt.usd(data.total24h, { compact: true }), MARGIN, 178, {
      font: `800 46px "${fontFamilyBold}"`,
      color: '#FFFFFF',
    });
    drawText(ctx, `Across ${data.marketCount} active markets`, MARGIN, 214, {
      font: `600 16px "${fontFamily}"`,
      color: '#FFFFFF',
    });
    // Real 24H change in platform volume itself (see metricHistory.js) —
    // "—" until a snapshot from ~24h ago is on file.
    if (data.change24h !== null && data.change24h !== undefined) {
      const volUp = data.change24h >= 0;
      drawText(ctx, `${volUp ? '▲' : '▼'} ${fmt.pctFromFraction(data.change24h)} vs. 24H ago`, MARGIN, 244, {
        font: `600 16px "${fontFamily}"`,
        color: volUp ? '#5CF29C' : '#FF6B6B',
      });
    }
  }

  drawFooter(ctx, W, H);
  const buffer = await canvas.encode('png');
  return new AttachmentBuilder(buffer, { name: 'volume-card.png' });
}

module.exports = { renderVolumeCard };