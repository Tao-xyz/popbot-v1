'use strict';

const { AttachmentBuilder } = require('discord.js');
const { newCanvas, loadAsset, drawBackground, drawLogo, drawFooter, drawText, ensureFonts } = require('./canvasUtils');
const fmt = require('../utils/format');

const W = 680;
const H = 300;
const MARGIN = 28;

function wrapText(ctx, text, maxWidth) {
  const words = String(text || '').split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

// Same wrapping logic as wrapText, but returns every line instead of
// capping at 3 — used by the daily news paragraph, which can run long.
function wrapParagraph(ctx, text, maxWidth) {
  const words = String(text || '').split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Renders an "upcoming listing" card.
 */
async function renderUpcomingListingCard(item) {
  const { fontFamily, fontFamilyBold } = ensureFonts();
  const { canvas, ctx } = newCanvas(W, H);
  const bg = await loadAsset('news.png');
  drawBackground(ctx, W, H, bg);
  await drawLogo(ctx, { x: MARGIN, y: 22, height: 46 });

  drawText(ctx, 'UPCOMING LISTING', MARGIN, 100, {
    font: `700 14px "${fontFamilyBold}"`,
    color: '#7DF9FF',
  });
  drawText(ctx, item.symbol || item.title, MARGIN, 156, { font: `800 34px "${fontFamilyBold}"` });
  drawText(ctx, 'Not yet trading', MARGIN, 184, {
    font: `600 16px "${fontFamily}"`,
    color: 'rgba(255,255,255,0.65)',
  });
  drawText(ctx, `Announced ${fmt.timeAgo(item.sendTime)}`, MARGIN, 236, {
    font: `600 14px "${fontFamily}"`,
    color: 'rgba(255,255,255,0.55)',
  });

  drawFooter(ctx, W, H);
  const buffer = await canvas.encode('png');
  return new AttachmentBuilder(buffer, { name: 'news-upcoming.png' });
}

/**
 * Renders a "listing is live" card with live market data.
 */
async function renderLiveListingCard(item, ticker) {
  const { fontFamily, fontFamilyBold } = ensureFonts();
  const { canvas, ctx } = newCanvas(W, H);
  const bg = await loadAsset('news.png');
  drawBackground(ctx, W, H, bg);
  await drawLogo(ctx, { x: MARGIN, y: 22, height: 46 });

  drawText(ctx, 'NOW LIVE', MARGIN, 100, { font: `700 14px "${fontFamilyBold}"`, color: '#5CF29C' });
  drawText(ctx, ticker?.symbol || item.symbol, MARGIN, 148, { font: `800 30px "${fontFamilyBold}"` });

  const stats = [
    ['PRICE', ticker ? fmt.price(ticker.lastPrice) : '—'],
    ['24H', ticker ? fmt.pctFromFraction(ticker.price24hPcnt) : '—'],
    ['VOLUME', ticker ? fmt.usd(ticker.turnover24h, { compact: true }) : '—'],
    ['OI', ticker ? fmt.compact(ticker.openInterest) : '—'],
  ];
  const colW = (W - MARGIN * 2) / 4;
  stats.forEach(([label, value], i) => {
    const x = MARGIN + i * colW;
    drawText(ctx, label, x, 194, { font: `600 11px "${fontFamily}"`, color: 'rgba(255,255,255,0.55)' });
    drawText(ctx, value, x, 220, { font: `700 18px "${fontFamilyBold}"` });
  });

  drawFooter(ctx, W, H);
  const buffer = await canvas.encode('png');
  return new AttachmentBuilder(buffer, { name: 'news-live.png' });
}

/**
 * Renders a general market-news event card (post 72h listing window, or
 * any classified market event: Major Movement / Volume Spike / OI Movement).
 */
async function renderMarketEventCard(item) {
  const { fontFamily, fontFamilyBold } = ensureFonts();
  const { canvas, ctx } = newCanvas(W, H);
  const bg = await loadAsset('news.png');
  drawBackground(ctx, W, H, bg);
  await drawLogo(ctx, { x: MARGIN, y: 22, height: 46 });

  drawText(ctx, item.symbol ? `MARKET NEWS • ${item.symbol}` : 'MARKET NEWS', MARGIN, 100, {
    font: `700 14px "${fontFamilyBold}"`,
    color: '#7DF9FF',
  });
  drawText(ctx, item.title || 'Update', MARGIN, 142, { font: `800 24px "${fontFamilyBold}"` });

  ctx.font = `500 15px "${fontFamily}"`;
  const lines = wrapText(ctx, item.content, W - MARGIN * 2);
  lines.forEach((line, i) => {
    drawText(ctx, line, MARGIN, 174 + i * 22, { font: `500 15px "${fontFamily}"`, color: 'rgba(255,255,255,0.8)' });
  });

  drawText(ctx, fmt.timeAgo(item.sendTime), MARGIN, 262, {
    font: `600 13px "${fontFamily}"`,
    color: 'rgba(255,255,255,0.5)',
  });

  drawFooter(ctx, W, H);
  const buffer = await canvas.encode('png');
  return new AttachmentBuilder(buffer, { name: 'news-event.png' });
}

/**
 * Renders the daily market recap as a paragraph-style card — one block
 * of body text (top gainers, volume, OI leader, and a liquidation
 * sentence when that data is real) instead of a stat grid. Per spec:
 * pure white text throughout (no gray/dimmed opacity, no green tint —
 * every other card's muted-white labels don't apply here), and the
 * canvas height is computed from the actual wrapped line count so long
 * or short paragraphs never overlap the footer or get cut off.
 */
async function renderDailyNewsCard(paragraph, { title = 'DAILY MARKET RECAP', dateLabel } = {}) {
  const { fontFamily, fontFamilyBold } = ensureFonts();
  const W = 760;
  const MARGIN = 32;
  const bodyFont = 16;
  const lineHeight = 27;
  // Was 150 — with the date sitting at y=132 that left only an 18px gap
  // before the paragraph started, so it read as one cramped block. Moving
  // the paragraph start down to 184 gives it real breathing room under
  // the date line.
  const headerTop = 184; // logo + title + date rows + gap
  const footerPad = 56;

  // Measure on a throwaway canvas first so we can size the real one to
  // exactly fit the wrapped paragraph — no guessing, no overlap risk.
  const { ctx: measureCtx } = newCanvas(W, 10);
  measureCtx.font = `500 ${bodyFont}px "${fontFamily}"`;
  const lines = wrapParagraph(measureCtx, paragraph, W - MARGIN * 2);

  const H = headerTop + Math.max(1, lines.length) * lineHeight + footerPad;
  const { canvas, ctx } = newCanvas(W, H);
  const bg = await loadAsset('news.png');
  drawBackground(ctx, W, H, bg);
  await drawLogo(ctx, { x: MARGIN, y: 24, height: 48 });

  drawText(ctx, title, MARGIN, 108, { font: `800 24px "${fontFamilyBold}"`, color: '#FFFFFF' });
  if (dateLabel) {
    drawText(ctx, dateLabel, MARGIN, 132, { font: `600 14px "${fontFamily}"`, color: '#FFFFFF' });
  }

  lines.forEach((line, i) => {
    drawText(ctx, line, MARGIN, headerTop + i * lineHeight, {
      font: `500 ${bodyFont}px "${fontFamily}"`,
      color: '#FFFFFF',
    });
  });

  drawFooter(ctx, W, H);
  const buffer = await canvas.encode('png');
  return new AttachmentBuilder(buffer, { name: 'news-daily-recap.png' });
}

module.exports = {
  renderUpcomingListingCard,
  renderLiveListingCard,
  renderMarketEventCard,
  renderDailyNewsCard,
};