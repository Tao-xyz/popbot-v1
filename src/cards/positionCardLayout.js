'use strict';

/**
 * SINGLE SOURCE OF TRUTH for the Position Card layout — both the static
 * canvas renderer (positionsCard.js) and the animated ffmpeg renderer
 * (animatedPositionCard.js) read this same file. Change a number here and
 * BOTH card types move together.
 *
 * Everything is a FRACTION of the card's own width/height, so it scales
 * regardless of the actual W×H you render at.
 *
 * Card aspect ratio is fixed at 2:1 (width = 2 × height).
 */

const ASPECT_RATIO = 2; // width / height

const LAYOUT = {
  aspectRatio: ASPECT_RATIO,

  panelWidthFrac: 0.6, // left 60% = data-text zone, per spec
  panelFadeFrac: 0.66, // still used by animatedPositionCard.js
  margin: 0.04,

  frame: {
    widthPx: 3,
    color: 'rgba(255,255,255,0.22)',
    inset: 2,
    radius: 16, // static-only — ffmpeg's drawbox has no rounded-corner option
  },

  logo: { x: 0.04, y: 0.06, heightFrac: 0.115 },

  // Bigger gap under the logo row before the symbol starts (was cramped).
  symbol: { y: 0.275, size: 0.058 },

  // Side + leverage TOGETHER again: "LONG • 20x" in one line. Leverage
  // does NOT appear in the grid anymore — that cell is now REFERRAL.
  sideLine: { y: 0.34, size: 0.04 },

  pnl: { y: 0.525, size: 0.128 },
  // Bumped from 0.027 — was reading as a small dim caption; per spec every
  // heading in this card should be full-size and fully legible.
  pnlLabel: { y: 0.575, size: 0.031 },

  // 2×2 grid: ENTRY / MARKET on row 1, LIQ / REFERRAL on row 2.
  // Referral used to be a separate tiny footnote — it's now a first-class
  // grid field, rendered larger than the other three (referralValueSize).
  // All sizes bumped up a step per spec ("all text bit bigger").
  grid: {
    top: 0.675,
    rowH: 0.155,
    valueOffset: 0.054,
    labelSize: 0.032,
    valueSize: 0.048,
    referralValueSize: 0.056,
    cols: 2,
  },

  footer: { size: 0.03 },
};

module.exports = LAYOUT;