'use strict';

const { AttachmentBuilder } = require('discord.js');
const { newCanvas, loadAsset, drawBackground, drawLogo, drawFooter, drawText, ensureFonts } = require('./canvasUtils');
const fmt = require('../utils/format');

const W = 760;
const H = 440;
const MARGIN = 32;

async function renderMarketCard(ticker) {
  const { fontFamily, fontFamilyBold } = ensureFonts();
  const { canvas, ctx } = newCanvas(W, H);
  const bg = await loadAsset('market.png');
  drawBackground(ctx, W, H, bg);

  // Logo gets its own top row — full size, nothing crammed beside it.
  await drawLogo(ctx, { x: MARGIN, y: 26, height: 58 });

  const up = Number(ticker.price24hPcnt) >= 0;
  const changeColor = up ? '#5CF29C' : '#FF6B6B';

  drawText(ctx, ticker.symbol, MARGIN, 122, {
    font: `700 22px "${fontFamilyBold}"`,
    color: 'rgba(255,255,255,0.85)',
  });

  drawText(ctx, fmt.price(ticker.lastPrice), MARGIN, 180, {
    font: `800 52px "${fontFamilyBold}"`,
  });
  drawText(ctx, `${up ? '▲' : '▼'} ${fmt.pctFromFraction(ticker.price24hPcnt)}`, MARGIN, 212, {
    font: `700 20px "${fontFamilyBold}"`,
    color: changeColor,
  });

  const stats = [
    ['24H VOLUME', fmt.usd(ticker.turnover24h, { compact: true })],
    ['OPEN INTEREST', fmt.usd(Number(ticker.openInterest || 0) * Number(ticker.markPrice || ticker.lastPrice || 0), { compact: true })],
    ['FUNDING RATE', ticker.fundingRate != null ? fmt.pctFromFraction(ticker.fundingRate, { decimals: 4 }) : '—'],
    ['24H HIGH', fmt.price(ticker.highPrice24h)],
    ['24H LOW', fmt.price(ticker.lowPrice24h)],
    ['MARK PRICE', fmt.price(ticker.markPrice)],
  ];

  const colW = (W - MARGIN * 2) / 3;
  const rowH = 96;
  const gridTop = 278;
  stats.forEach(([label, value], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = MARGIN + col * colW;
    const y = gridTop + row * rowH;
    drawText(ctx, label, x, y, { font: `600 12px "${fontFamily}"`, color: 'rgba(255,255,255,0.6)' });
    drawText(ctx, value, x, y + 28, { font: `700 22px "${fontFamilyBold}"` });
  });

  drawFooter(ctx, W, H);
  const buffer = await canvas.encode('png');
  return new AttachmentBuilder(buffer, { name: 'market-card.png' });
}

module.exports = { renderMarketCard };
