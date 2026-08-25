'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const config = require('../config');

const FONT_REGULAR_PATH = path.join(config.paths.fonts, 'Arial.ttf');
const FONT_BOLD_PATH = path.join(config.paths.fonts, 'Arial-Bold.ttf');

let fontsRegistered = false;
let fontFamily = 'sans-serif';
let fontFamilyBold = 'sans-serif';

/**
 * Registers the Popdex Arial assets if present; otherwise falls back to the
 * system sans-serif so the bot still renders cards (with a console warning)
 * even before you've dropped in the real font files.
 */
function ensureFonts() {
  if (fontsRegistered) return { fontFamily, fontFamilyBold };
  fontsRegistered = true;

  if (fs.existsSync(FONT_REGULAR_PATH)) {
    GlobalFonts.registerFromPath(FONT_REGULAR_PATH, 'Popdex Sans');
    fontFamily = 'Popdex Sans';
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[cards] Missing ${FONT_REGULAR_PATH} — falling back to system sans-serif.`);
  }

  if (fs.existsSync(FONT_BOLD_PATH)) {
    GlobalFonts.registerFromPath(FONT_BOLD_PATH, 'Popdex Sans Bold');
    fontFamilyBold = 'Popdex Sans Bold';
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[cards] Missing ${FONT_BOLD_PATH} — falling back to system sans-serif bold.`);
    fontFamilyBold = fontFamily;
  }

  return { fontFamily, fontFamilyBold };
}

async function loadAsset(fileName) {
  const p = path.join(config.paths.assets, fileName);
  if (!fs.existsSync(p)) return null;
  try {
    return await loadImage(p);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[cards] Failed to load asset ${fileName}:`, err.message);
    return null;
  }
}

/**
 * Returns a fully desaturated (true grayscale) copy of an image, computed
 * pixel-by-pixel (luminance formula), regardless of any color grading
 * baked into the source file. Used by /performance to reuse market.png's
 * artwork without carrying over its green/teal color grading.
 */
function desaturateImage(img) {
  const off = createCanvas(img.width, img.height);
  const octx = off.getContext('2d');
  octx.drawImage(img, 0, 0);
  const imageData = octx.getImageData(0, 0, img.width, img.height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = gray;
    d[i + 1] = gray;
    d[i + 2] = gray;
  }
  octx.putImageData(imageData, 0, 0);
  return off;
}

function newCanvas(width, height) {
  ensureFonts();
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  return { canvas, ctx };
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = typeof r === 'number' ? { tl: r, tr: r, br: r, bl: r } : r;
  ctx.beginPath();
  ctx.moveTo(x + radius.tl, y);
  ctx.lineTo(x + w - radius.tr, y);
  ctx.arcTo(x + w, y, x + w, y + radius.tr, radius.tr);
  ctx.lineTo(x + w, y + h - radius.br);
  ctx.arcTo(x + w, y + h, x + w - radius.br, y + h, radius.br);
  ctx.lineTo(x + radius.bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius.bl, radius.bl);
  ctx.lineTo(x, y + radius.tl);
  ctx.arcTo(x, y, x + radius.tl, y, radius.tl);
  ctx.closePath();
}

/**
 * Draws a background asset (market.png / news.png / vault.png / etc.)
 * cover-fit into the canvas. Falls back to a dark gradient if the asset is
 * missing so cards remain usable before real brand assets are supplied.
 */
function drawBackground(ctx, width, height, bgImage) {
  if (bgImage) {
    const scale = Math.max(width / bgImage.width, height / bgImage.height);
    const w = bgImage.width * scale;
    const h = bgImage.height * scale;
    ctx.drawImage(bgImage, (width - w) / 2, (height - h) / 2, w, h);
    // subtle darken overlay so white text stays readable over any art
    ctx.fillStyle = 'rgba(6, 8, 14, 0.35)';
    ctx.fillRect(0, 0, width, height);
  } else {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#0b0e17');
    grad.addColorStop(1, '#151a2b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }
}

/**
 * Draws the Popdex logo at a generous, prominent size — contain-fit
 * (never stretched/distorted) preserving its real aspect ratio, with NO
 * cropping mask. Sized by `height`; width is derived from the logo's own
 * proportions so it never gets squeezed into a tiny square icon. No
 * "Popdex" wordmark is drawn beside it — the logo alone carries the brand.
 */
async function drawLogo(ctx, { x, y, height = 64 } = {}) {
  const logo = await loadAsset('logo.png');
  if (!logo) return { width: 0, height: 0 };
  const scale = height / logo.height;
  const w = logo.width * scale;
  ctx.save();
  // Force high-quality resampling. Without this, scaling the source PNG
  // down (or up) to the target height can default to a cheaper/blurrier
  // resample depending on the canvas backend. This only helps if the
  // source asset itself has enough resolution to begin with — a source
  // smaller than the target render size will still look soft no matter
  // what smoothing mode is used.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(logo, x, y, w, height);
  ctx.restore();
  return { width: w, height };
}

/**
 * Draws a soft rounded panel with a horizontal alpha fade — opaque near
 * `x`, fading to transparent by `x + w`. Used to seat a readable text
 * block over background art without hard-edging the art it sits on top of
 * (e.g. the left data column of the Position Card, in front of the right-
 * side artwork).
 */
function drawFadePanel(ctx, x, y, w, h, { from = 'rgba(6,8,14,0.82)', to = 'rgba(6,8,14,0)', radius = 18 } = {}) {
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  ctx.clip();
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, from);
  grad.addColorStop(0.82, from);
  grad.addColorStop(1, to);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/**
 * Draws a rounded-rect stroke around the entire card. Purely decorative —
 * drawn last so it sits crisply on top of the background/panel/text
 * instead of being covered by them.
 */
function drawFrame(ctx, width, height, { widthPx = 3, color = 'rgba(255,255,255,0.22)', inset = 2, radius = 16 } = {}) {
  ctx.save();
  roundRect(ctx, inset, inset, width - inset * 2, height - inset * 2, radius);
  ctx.lineWidth = widthPx;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws a small rounded "pill" with centered-vertically text inside —
 * used for the referral code badge so it reads as a proper UI element
 * instead of a squeezed-in footnote.
 */
function drawPill(ctx, text, { right, top, font, textColor = '#FFFFFF', bg = 'rgba(0,0,0,0.45)', padX = 14, padY = 8, radius = 999 } = {}) {
  ctx.save();
  ctx.font = font;
  const textW = ctx.measureText(text).width;
  const boxW = textW + padX * 2;
  const sizeMatch = /(\d+)px/.exec(font);
  const fontSize = sizeMatch ? Number(sizeMatch[1]) : 16;
  const h = padY * 2 + fontSize;
  const x = right - boxW;
  const y = top;

  roundRect(ctx, x, y, boxW, h, radius);
  ctx.fillStyle = bg;
  ctx.fill();

  ctx.fillStyle = textColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + h / 2 + 1);
  ctx.restore();

  return { x, y, width: boxW, height: h };
}

/**
 * Draws the "Trade on app.popdex.xyz" footer signature — bottom-right, full
 * solid white (not dimmed/gray) per spec, small enough to stay out of the
 * way of the primary data without reading as low-opacity.
 */
function drawFooter(ctx, width, height) {
  const { fontFamily: fam } = ensureFonts();
  ctx.save();
  ctx.font = `700 11px "${fam}"`;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(config.branding.footer, width - 18, height - 14);
  ctx.restore();
}

function drawText(ctx, text, x, y, { font, color = '#FFFFFF', align = 'left', baseline = 'alphabetic' } = {}) {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
  ctx.restore();
}

module.exports = {
  ensureFonts,
  loadAsset,
  desaturateImage,
  newCanvas,
  roundRect,
  drawBackground,
  drawLogo,
  drawFadePanel,
  drawFrame,
  drawPill,
  drawFooter,
  drawText,
};