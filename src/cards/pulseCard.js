'use strict';

const { AttachmentBuilder } = require('discord.js');
const { newCanvas, loadAsset, drawBackground, drawLogo, drawFooter, drawText, ensureFonts } = require('./canvasUtils');
const fmt = require('../utils/format');

const W = 680;
const H = 380;
const MARGIN = 28;

async function renderPulseCard(pulse) {
  const { fontFamily, fontFamilyBold } = ensureFonts();
  const { canvas, ctx } = newCanvas(W, H);
  const bg = await loadAsset('market.png');
  drawBackground(ctx, W, H, bg);

  await drawLogo(ctx, { x: MARGIN, y: 24, height: 50 });
  drawText(ctx, 'MARKET PULSE', MARGIN, 106, { font: `700 16px "${fontFamilyBold}"`, color: 'rgba(255,255,255,0.7)' });

  const moverUp = Number(pulse.biggestMover?.price24hPcnt) >= 0;

  const rows = [
    ['TOP VOLUME', pulse.topVolume?.symbol, fmt.usd(pulse.topVolume?.turnover24h, { compact: true })],
    [
      'BIGGEST MOVER',
      pulse.biggestMover?.symbol,
      `${moverUp ? '▲' : '▼'} ${fmt.pctFromFraction(pulse.biggestMover?.price24hPcnt)}`,
    ],
    ['BIGGEST OI', pulse.biggestOiTicker?.symbol, pulse.biggestOiUsd != null ? fmt.usd(pulse.biggestOiUsd, { compact: true }) : '—'],
  ];

  const rowTop = 148;
  const rowH = 76;
  rows.forEach(([label, symbol, value], i) => {
    const y = rowTop + i * rowH;
    drawText(ctx, label, MARGIN, y, { font: `600 12px "${fontFamily}"`, color: 'rgba(255,255,255,0.55)' });
    drawText(ctx, symbol || '—', MARGIN, y + 30, { font: `700 24px "${fontFamilyBold}"` });
    drawText(ctx, value || '—', W - MARGIN, y + 30, {
      font: `700 22px "${fontFamilyBold}"`,
      align: 'right',
      color: i === 1 ? (moverUp ? '#5CF29C' : '#FF6B6B') : '#FFFFFF',
    });
  });

  drawFooter(ctx, W, H);
  const buffer = await canvas.encode('png');
  return new AttachmentBuilder(buffer, { name: 'pulse-card.png' });
}

module.exports = { renderPulseCard };
