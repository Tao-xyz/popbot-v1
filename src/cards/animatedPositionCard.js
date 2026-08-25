'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const { AttachmentBuilder } = require('discord.js');
const config = require('../config');
const fmt = require('../utils/format');
const LAYOUT = require('./positionCardLayout');

try {
  // eslint-disable-next-line global-require
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  ffmpeg.setFfmpegPath(ffmpegInstaller.path);
} catch {
  // Falls back to whatever `ffmpeg` is on PATH. See README "Requirements".
}

const FONT_BOLD = path.join(config.paths.fonts, 'Arial-Bold.ttf');
const FONT_REGULAR = path.join(config.paths.fonts, 'Arial.ttf');
const LOGO_PATH = path.join(config.paths.assets, 'logo.png');

// Trimmed from 5s — every extra second is more frames to draw text on,
// more frames to palette/dither, and a bigger file to upload to Discord.
// 3s still loops the template at least once for anyone watching.
const MIN_DURATION_SECONDS = 3;

// Output is a GIF, not an MP4 — Discord renders GIFs inline as an
// autoplaying image with no play/pause transport bar. Capped fps keeps
// file size sane and render time down; bump it if you want smoother
// motion at the cost of speed/size.
const GIF_FPS = 12;

// ── Content layout, specific to this card's redesign ─────────────────────
// The generic geometry (aspect ratio, margin, frame, logo, footer, panel
// fade) still comes from positionCardLayout.js, shared with the static
// renderer. Everything below is the new text layout matching the approved
// reference card: logo → "Position" kicker → divider → "SYMBOL · SIDE · Nx"
// → "PROFIT / LOSS" label → big % value → ENTRY PRICE row → MARKET PRICE /
// REFERRAL CODE row. It intentionally does NOT touch positionCardLayout.js
// or positionsCard.js — only this file changes.
// All label/value sizes bumped a step up from the previous pass — per
// spec every heading and value on this card should read as full-size and
// clearly legible, not like a small dim caption.
const CARD = {
  subtitle: { y: 0.15, size: 0.032 },
  divider: { y: 0.226 },
  symbolLine: { y: 0.265, size: 0.054 },
  pnlLabel: { y: 0.36, size: 0.032 },
  pnlValue: { y: 0.4, size: 0.118 },
  entryLabel: { y: 0.6, size: 0.032 },
  entryValue: { y: 0.645, size: 0.054 },
  row2Label: { y: 0.745, size: 0.032 },
  row2Value: { y: 0.79, size: 0.054 },
};

function escapeDrawtext(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function probeDurationSeconds(filePath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) {
        resolve(null);
        return;
      }
      const duration = Number(data?.format?.duration);
      resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
    });
  });
}

const frac = (f) => Number(f.toFixed(4));

/**
 * Renders one of the two premium animated position card templates
 * (assets/position_3.mp4 or position_4.mp4) with live trading data
 * overlaid, as a GIF (no player controls).
 *
 * Layout: logo, "Position" kicker, divider, "SYMBOL · SIDE · Nx" line,
 * "PROFIT / LOSS" label + big PnL %, ENTRY PRICE row, then MARKET PRICE /
 * REFERRAL CODE row, frame.
 */
async function renderAnimatedPositionCard(position, referralCode, design = 3) {
  const templatePath = path.join(config.paths.assets, `position_${design}.mp4`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(
      `Animated card template missing: assets/position_${design}.mp4. ` +
        'Drop the premium MP4 template asset in place before using animated cards.'
    );
  }
  const fontFile = fs.existsSync(FONT_BOLD) ? FONT_BOLD : null;
  const fontFileRegular = fs.existsSync(FONT_REGULAR) ? FONT_REGULAR : fontFile;
  if (!fontFile) {
    throw new Error('Missing assets/fonts/Arial-Bold.ttf — required for animated card text overlay.');
  }
  const hasLogo = fs.existsSync(LOGO_PATH);

  // ── Ensure the output is at least MIN_DURATION_SECONDS long ──────────
  const nativeDuration = await probeDurationSeconds(templatePath);
  let loopCount = 0;
  let targetDuration = null;
  if (nativeDuration === null) {
    loopCount = 24;
    targetDuration = MIN_DURATION_SECONDS;
  } else if (nativeDuration < MIN_DURATION_SECONDS) {
    loopCount = Math.max(1, Math.ceil(MIN_DURATION_SECONDS / nativeDuration) - 1);
    targetDuration = MIN_DURATION_SECONDS;
  }

  const isLong = position.positionSide === 'Long';
  const pnlPct =
    Number(position.avgOpenPrice) > 0
      ? ((Number(position.markPrice) - Number(position.avgOpenPrice)) / Number(position.avgOpenPrice)) *
        (isLong ? 1 : -1) *
        Number(position.symbolLeverage || 1)
      : null;
  const pnlColor = pnlPct !== null && pnlPct >= 0 ? '0x5CF29C' : '0xFF6B6B';

  const MARGIN_X = `w*${frac(LAYOUT.margin)}`;

  // Two-column geometry for the MARKET PRICE / REFERRAL CODE row — same
  // math positionsCard.js uses for its grid, just applied to one row here.
  const rightEdgeFrac = LAYOUT.panelWidthFrac - 0.02;
  const usableWidthFrac = rightEdgeFrac - LAYOUT.margin;
  const colWFrac = usableWidthFrac / 2;
  const col0X = MARGIN_X;
  const col1X = `w*${frac(LAYOUT.margin + colWFrac)}`;

  // "ETHUSDT · LONG · 20x" — one plain-white line. NOTE: this uses a
  // middle dot (U+00B7), not a bullet (U+2022). The bullet glyph is
  // missing from the shipped Arial-Bold.ttf subset and was rendering as
  // an empty tofu box — the middle dot is present in every Latin font and
  // matches the reference design anyway.
  const symbolLineText = `${position.symbol} \u00B7 ${isLong ? 'LONG' : 'SHORT'} \u00B7 ${position.symbolLeverage}x`;

  // Every heading/label below is full solid white (0xFFFFFF), not the
  // previous dimmed 0xFFFFFFAA — per spec, no gray/low-opacity tone
  // anywhere on this card, headings included.
  const lines = [
    { text: 'Position', x: MARGIN_X, y: `h*${frac(CARD.subtitle.y)}`, size: `h*${frac(CARD.subtitle.size)}`, color: '0xFFFFFF', font: fontFileRegular },
    { text: symbolLineText, x: MARGIN_X, y: `h*${frac(CARD.symbolLine.y)}`, size: `h*${frac(CARD.symbolLine.size)}`, color: '0xFFFFFF', font: fontFile },

    // Label sits clearly ABOVE the value now — previously pnlLabel.y fell
    // *inside* the big value's own text box (0.575 vs a value spanning
    // ~0.525–0.68), so the tiny label got stamped over/inside the giant
    // percentage and, combined with GIF dithering, read as if the whole
    // PnL block was simply missing. Label-then-value with real clearance
    // fixes that.
    { text: 'PROFIT / LOSS', x: MARGIN_X, y: `h*${frac(CARD.pnlLabel.y)}`, size: `h*${frac(CARD.pnlLabel.size)}`, color: '0xFFFFFF', font: fontFile },
    { text: pnlPct !== null ? fmt.pct(pnlPct) : '0.00%', x: MARGIN_X, y: `h*${frac(CARD.pnlValue.y)}`, size: `h*${frac(CARD.pnlValue.size)}`, color: pnlColor, font: fontFile },

    // ENTRY PRICE — single full-width row (no LIQ. PRICE on this design).
    { text: 'ENTRY PRICE', x: col0X, y: `h*${frac(CARD.entryLabel.y)}`, size: `h*${frac(CARD.entryLabel.size)}`, color: '0xFFFFFF', font: fontFile },
    { text: fmt.price(position.avgOpenPrice), x: col0X, y: `h*${frac(CARD.entryValue.y)}`, size: `h*${frac(CARD.entryValue.size)}`, color: '0xFFFFFF', font: fontFile },

    // MARKET PRICE (col 0) / REFERRAL CODE (col 1)
    { text: 'MARKET PRICE', x: col0X, y: `h*${frac(CARD.row2Label.y)}`, size: `h*${frac(CARD.row2Label.size)}`, color: '0xFFFFFF', font: fontFile },
    { text: fmt.price(position.markPrice), x: col0X, y: `h*${frac(CARD.row2Value.y)}`, size: `h*${frac(CARD.row2Value.size)}`, color: '0xFFFFFF', font: fontFile },
  ];
  if (referralCode) {
    lines.push({ text: 'REFERRAL CODE', x: col1X, y: `h*${frac(CARD.row2Label.y)}`, size: `h*${frac(CARD.row2Label.size)}`, color: '0xFFFFFF', font: fontFile });
    // Referral value is now plain white (was cyan) to match the
    // "white tone" spec instead of standing out as a different color.
    lines.push({ text: referralCode, x: col1X, y: `h*${frac(CARD.row2Value.y)}`, size: `h*${frac(CARD.row2Value.size)}`, color: '0xFFFFFF', font: fontFile });
  }
  lines.push({
    text: config.branding.footer,
    x: `w-text_w-${MARGIN_X}`,
    y: `h-text_h-h*0.04`,
    size: `h*${frac(LAYOUT.footer.size)}`,
    color: '0xFFFFFF',
    font: fontFile,
  });

  const drawtextChain = lines
    .map(
      (l) =>
        `drawtext=fontfile='${l.font}':text='${escapeDrawtext(l.text)}':` +
        `fontsize=${l.size}:fontcolor=${l.color}:x=${l.x}:y=${l.y}`
    )
    .join(',');

  const scrim = `drawbox=x=0:y=0:w=iw*${frac(LAYOUT.panelFadeFrac)}:h=ih:color=black@0.42:t=fill`;
  const divider = `drawbox=x=${MARGIN_X}:y=h*${frac(CARD.divider.y)}:w=w*${frac(rightEdgeFrac - LAYOUT.margin)}:h=1:color=white@0.15:t=fill`;
  const frameBox =
    `drawbox=x=${LAYOUT.frame.inset}:y=${LAYOUT.frame.inset}:` +
    `w=iw-${LAYOUT.frame.inset * 2}:h=ih-${LAYOUT.frame.inset * 2}:` +
    `color=white@0.22:t=${LAYOUT.frame.widthPx}`;

  // ── Build the filter graph ────────────────────────────────────────────
  // Loop the DECODED frames inside the graph, instead of using the
  // `-stream_loop` input option. `-stream_loop` rewinds and re-opens the
  // input stream to repeat it, and doing that in the middle of a complex
  // filtergraph forces stateful filters downstream (scale2ref for the
  // logo overlay, palettegen/paletteuse for the GIF palette) to
  // reinitialize mid-stream — which is exactly the
  // "Error reinitializing filters! Failed to inject frame into filter
  // network" crash. The `loop` filter buffers and repeats frames entirely
  // inside the graph, so the input is only ever opened once and nothing
  // downstream ever needs to reinit. `size=32767` is comfortably more
  // frames than a few-second template clip will ever have, so the whole
  // clip fits in the loop buffer.
  const loopFilter = loopCount > 0 ? `[0:v]loop=loop=${loopCount}:size=32767:start=0[loopedv];` : '';
  const videoLabel = loopCount > 0 ? '[loopedv]' : '[0:v]';

  // With the logo present this is a two-input complex filtergraph
  // (template video + logo still image); without it, a single-input chain.
  const logoScaleOverlay = hasLogo
    ? `[1:v]${videoLabel}scale2ref=w=-1:h=main_h*${frac(LAYOUT.logo.heightFrac)}[logo][vid0];` +
      `[vid0][logo]overlay=x=main_w*${frac(LAYOUT.logo.x)}:y=main_h*${frac(LAYOUT.logo.y)}[vid1];`
    : '';
  const baseLabel = hasLogo ? '[vid1]' : videoLabel;

  const filterGraph =
    `${loopFilter}` +
    `${logoScaleOverlay}` +
    `${baseLabel}${scrim},${divider},${drawtextChain},${frameBox}[styled];` +
    // Cap frame rate, then palette-optimize for a clean, FAST-to-render
    // GIF. stats_mode=diff (not full) — diff only samples pixels that
    // change between frames, which is significantly cheaper than
    // scanning every pixel of every frame and is the main lever for
    // render speed here. Dither mode is `sierra2_4a` (see the comment
    // right above the paletteuse call below for why: dither=none kept
    // text crisp but made the logo's smooth edges look blocky/pixelated;
    // sierra2_4a fixes that without bringing back the noisy-text problem
    // a heavier dither like bayer caused).
    `[styled]fps=${GIF_FPS}[gifin];` +
    `[gifin]split[p1][p2];` +
    `[p1]palettegen=stats_mode=diff[palette];` +
    // dither=none (the previous setting) kept text perfectly crisp but
    // came at a real cost: with NO dithering at all, every soft/
    // anti-aliased edge in the frame — most visibly the logo's curved
    // edges and the star icon — gets hard-quantized to whichever single
    // palette color is closest, so smooth edges collapse into a blocky,
    // "pixelated" staircase instead of a clean curve. `sierra2_4a` is a
    // light error-diffusion dither: it restores that smooth edge on the
    // logo (verified side-by-side against a non-palette reference frame)
    // without reintroducing the visible noise/glitching that a stronger
    // dither (e.g. the default `bayer`) caused on the text — confirmed
    // by rendering both and comparing crops of the logo and the text.
    `[p2][palette]paletteuse=dither=sierra2_4a[out]`;

  const outPath = path.join(os.tmpdir(), `popdex-position-${crypto.randomUUID()}.gif`);

  await new Promise((resolve, reject) => {
    const command = ffmpeg(templatePath);
    // NOTE: deliberately NOT using `-stream_loop` here — looping happens
    // inside the filtergraph instead (see `loopFilter` above). See the
    // comment there for why: `-stream_loop` + complex filtergraph is what
    // was causing the "Error reinitializing filters!" crash.
    if (hasLogo) {
      // Cap the logo image's OWN duration as an INPUT option (`-t`
      // before `-i`), not just an output-level limit. This is the actual
      // fix for the "animated card shows nothing" bug: `-loop 1` makes
      // the logo an infinite stream, and once the GIF path's `split` +
      // `palettegen`/`paletteuse` branches it into two consumers, an
      // output-level `-t`/`-shortest` does NOT reliably cut that infinite
      // stream off — ffmpeg just hangs forever encoding, the render
      // promise never resolves, and nothing ever reaches Discord. Giving
      // the image input its own finite length up front avoids the hang
      // entirely. Verified against the real templates.
      const logoDuration = targetDuration || nativeDuration || MIN_DURATION_SECONDS;
      command.input(LOGO_PATH).inputOptions(['-loop 1', '-t', String(logoDuration)]);
    }
    command.complexFilter(filterGraph, 'out');
    command.outputOptions(['-loop', '0']); // 0 = loop forever, standard for GIFs
    if (targetDuration) {
      command.duration(targetDuration);
    } else if (hasLogo && nativeDuration) {
      command.duration(nativeDuration);
    }
    command
      .save(outPath)
      .on('end', resolve)
      .on('error', reject);
  });

  const buffer = fs.readFileSync(outPath);
  fs.unlink(outPath, () => {});
  return new AttachmentBuilder(buffer, { name: `position-card-${design}.gif` });
}

module.exports = { renderAnimatedPositionCard };