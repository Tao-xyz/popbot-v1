const path = require("path");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");

// ---------------------------------------------------------------------------
// FONT SETUP
// ---------------------------------------------------------------------------
// Arial is a licensed Microsoft font — it is usually NOT installed on Linux
// hosts (Railway, etc.) and can't legally be redistributed in your repo.
//
// Recommended: use "Arimo" (Google's free, metrics-compatible Arial clone —
// looks essentially identical to Arial). Download the two files below and
// place them in a `fonts/` folder next to this file:
//   fonts/Arimo-Regular.ttf
//   fonts/Arimo-Bold.ttf
// Get them free at: https://fonts.google.com/specimen/Arimo
//
// If you own a real Arial license and prefer to use it instead, just save
// your files as fonts/arial.ttf and fonts/arial-bold.ttf and it'll work the
// same way — no other code changes needed.
// ---------------------------------------------------------------------------

const FONT_REGULAR_PATH = path.join(__dirname, "fonts", "Arimo-Regular.ttf");
const FONT_BOLD_PATH = path.join(__dirname, "fonts", "Arimo-Bold.ttf");
const FONT_FAMILY = "CardFont";

try {
  GlobalFonts.registerFromPath(FONT_REGULAR_PATH, FONT_FAMILY);
  GlobalFonts.registerFromPath(FONT_BOLD_PATH, `${FONT_FAMILY}-Bold`);
} catch (err) {
  console.warn(
    "[cardRenderer] Could not load font files from ./fonts — falling back to a system default font. " +
    "Add fonts/Arimo-Regular.ttf and fonts/Arimo-Bold.ttf (see comment at top of cardRenderer.js). " +
    "Error: " + err.message
  );
}

// ---------------------------------------------------------------------------
// BACKGROUND IMAGE SETUP
// ---------------------------------------------------------------------------
// This image is drawn as the FULL background of the card (not a small corner
// logo). Loaded ONCE from a local file bundled in your project — NOT fetched
// from GitHub at render time. This avoids depending on GitHub being fast/
// reachable from your host, and avoids the image getting stuck as "failed"
// forever if the very first fetch attempt after startup didn't go through.
//
// Put your image at:  assets/new.png   (next to this file)
// ---------------------------------------------------------------------------

const BACKGROUND_SOURCE = path.join(__dirname, "assets", "new.png");

// How dark the overlay on top of the background image is, so stat text
// stays readable. 0 = no overlay (raw image), 1 = fully solid COLORS.panel.
// Tweak this if your image is busy/bright and text gets hard to read.
const OVERLAY_OPACITY = 0.72;

let cachedBackground = null;
let triedBackground = false;
async function getBackgroundImage() {
  if (triedBackground) return cachedBackground;
  triedBackground = true;
  try {
    cachedBackground = await loadImage(BACKGROUND_SOURCE);
  } catch (err) {
    console.warn(
      "[cardRenderer] Could not load background image from " + BACKGROUND_SOURCE + ". " +
      "Make sure the file exists at assets/new.png next to cardRenderer.js. Error: " + err.message
    );
    cachedBackground = null;
    triedBackground = false; // allow retrying on the next card render, instead of failing forever
  }
  return cachedBackground;
}

// Draws `img` inside the rect (x, y, w, h) using "cover" behavior (like
// CSS background-size: cover) — fills the whole rect, cropping overflow,
// no stretching/distortion.
function drawImageCover(ctx, img, x, y, w, h) {
  const imgRatio = img.width / img.height;
  const boxRatio = w / h;

  let drawW, drawH, offsetX, offsetY;
  if (imgRatio > boxRatio) {
    // Image is wider than the box — fit height, crop width
    drawH = h;
    drawW = h * imgRatio;
    offsetX = (w - drawW) / 2;
    offsetY = 0;
  } else {
    // Image is taller than the box — fit width, crop height
    drawW = w;
    drawH = w / imgRatio;
    offsetX = 0;
    offsetY = (h - drawH) / 2;
  }

  ctx.drawImage(img, x + offsetX, y + offsetY, drawW, drawH);
}

// ---------------------------------------------------------------------------
// STYLE
// ---------------------------------------------------------------------------

const COLORS = {
  background: "#0d0d0d",
  panel: "#1a1a1a",
  border: "#2f2f2f",
  accent: "#3b82f6",
  positive: "#22c55e",
  negative: "#ef4444",
  gold: "#fbbf24",          // achievement / badge accent, kept distinct from PnL red/green
  textPrimary: "#ffffff",   // bright white
  textSecondary: "#d4d4d8"  // brighter secondary so labels don't fade out
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Truncates any decimal portion of a numeric value in a string down to at
// most 2 digits — "55.0092" -> "55.00", "$128,400.5567" -> "$128,400.55".
// Integers and values already <=2 decimals pass through unchanged. Works on
// numbers or strings so callers can pass either.
function formatValue(val) {
  if (typeof val !== "string" && typeof val !== "number") return val;
  const str = String(val);
  return str.replace(/(\d+)\.(\d+)/g, (match, intPart, decPart) => {
    if (decPart.length <= 2) return match;
    return `${intPart}.${decPart.slice(0, 2)}`;
  });
}

// Picks the largest font size (between minSize and startSize) at which
// `text` fits within `maxWidth`. Longer strings (e.g. "Entry / Current"
// position details) shrink instead of spilling out of their stat card.
function fitFontSize(ctx, text, maxWidth, startSize, minSize, fontWeight) {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `${size}px "${FONT_FAMILY}${fontWeight}"`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 1;
  }
  ctx.font = `${minSize}px "${FONT_FAMILY}${fontWeight}"`;
  return minSize;
}

// If text still doesn't fit at the minimum font size, truncate with an
// ellipsis rather than letting it run past the card edge.
function truncateToFit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

// Splits `text` on spaces into two lines, choosing the break point whose
// two halves are closest in width (and both fit within maxWidth) rather
// than always breaking at the midpoint character-wise. Used as a fallback
// for "position"-style rows whose value (symbol/side/leverage/ROE, etc.)
// is too long to fit on one line even at the minimum font size — instead
// of silently hiding the tail behind an ellipsis, it drops to a second
// line so the full detail stays visible. ctx.font must already be set to
// the size being measured before calling this.
function wrapTwoLines(ctx, text, maxWidth) {
  const words = String(text).split(" ");
  if (words.length < 2) return [text, ""];

  let bestSplit = Math.ceil(words.length / 2);
  let bestDiff = Infinity;
  let foundFit = false;
  for (let i = 1; i < words.length; i++) {
    const line1 = words.slice(0, i).join(" ");
    const line2 = words.slice(i).join(" ");
    const w1 = ctx.measureText(line1).width;
    const w2 = ctx.measureText(line2).width;
    if (w1 <= maxWidth && w2 <= maxWidth) {
      const diff = Math.abs(w1 - w2);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestSplit = i;
        foundFit = true;
      }
    }
  }
  // No split keeps both halves within maxWidth (a single word is too
  // long) — fall back to the midpoint split; truncateToFit on each line
  // at draw time still guards against overflow.
  if (!foundFit) bestSplit = Math.ceil(words.length / 2);

  return [words.slice(0, bestSplit).join(" "), words.slice(bestSplit).join(" ")];
}

// Draws a label + value stack, vertically centered as a block inside
// (x, y, w, h) rather than at hardcoded offsets. Because the label/value
// font sizes are computed live (via fitFontSize) and the block is
// centered using those *actual* sizes, this stays correctly aligned no
// matter how much a long string had to shrink — the old fixed-offset
// version could end up with cramped or lopsided spacing once a value
// shrunk well below its starting size.
function drawCellText(ctx, { x, y, w, h, align, padX, label, value, valueColor, labelStart, labelMin, valueStart, valueMin, gap = 6 }) {
  ctx.textAlign = align;
  const textX = align === "left" ? x + padX : x + w / 2;
  const maxW = w - padX * 2;

  const labelText = label.toUpperCase();
  const labelSize = fitFontSize(ctx, labelText, maxW, labelStart, labelMin, "-Bold");
  const labelStr = truncateToFit(ctx, labelText, maxW);

  const valueText = formatValue(value);
  const valueSize = fitFontSize(ctx, valueText, maxW, valueStart, valueMin, "-Bold");
  const valueStr = truncateToFit(ctx, valueText, maxW);

  const blockH = labelSize + gap + valueSize;
  const startY = y + (h - blockH) / 2;

  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = `${labelSize}px "${FONT_FAMILY}-Bold"`;
  ctx.fillText(labelStr, textX, startY);

  ctx.fillStyle = valueColor || COLORS.textPrimary;
  ctx.font = `${valueSize}px "${FONT_FAMILY}-Bold"`;
  ctx.fillText(valueStr, textX, startY + labelSize + gap);
}

// Same block-centering approach as drawCellText, but renders the value as
// two lines (via wrapTwoLines) instead of shrinking/truncating to one.
// Only used when a position row's value has already been confirmed (at
// layout time) not to fit on a single line at the minimum font size.
function drawCellTextWrapped(ctx, { x, y, w, h, padX, label, value, valueColor, labelSize, valueSize, gap = 5, lineGap = 4 }) {
  ctx.textAlign = "left";
  const textX = x + padX;
  const maxW = w - padX * 2;

  const labelText = label.toUpperCase();
  ctx.font = `${labelSize}px "${FONT_FAMILY}-Bold"`;
  const labelStr = truncateToFit(ctx, labelText, maxW);

  ctx.font = `${valueSize}px "${FONT_FAMILY}-Bold"`;
  const [rawLine1, rawLine2] = wrapTwoLines(ctx, formatValue(value), maxW);
  const line1 = truncateToFit(ctx, rawLine1, maxW);
  const line2 = truncateToFit(ctx, rawLine2, maxW);

  const blockH = labelSize + gap + valueSize + lineGap + valueSize;
  const startY = y + (h - blockH) / 2;

  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = `${labelSize}px "${FONT_FAMILY}-Bold"`;
  ctx.fillText(labelStr, textX, startY);

  ctx.fillStyle = valueColor || COLORS.textPrimary;
  ctx.font = `${valueSize}px "${FONT_FAMILY}-Bold"`;
  ctx.fillText(line1, textX, startY + labelSize + gap);
  ctx.fillText(line2, textX, startY + labelSize + gap + valueSize + lineGap);
}

// Renders a label on its own line, then two explicit content lines stacked
// below it (e.g. "LARGEST POSITION" / "BTCUSDT LONG 10x" / "+5.23% ROE").
// Unlike drawCellTextWrapped (which auto-splits ONE long value across two
// lines as an overflow fallback), this is for callers that already have
// two distinct pieces of data and want them on their own lines on
// purpose — each line gets its own font-fit pass and its own color.
// `align`/sizing are configurable so the same helper covers both a taller
// left-aligned position box and a compact center-aligned chip cell.
function drawCellTextStacked(ctx, {
  x, y, w, h, padX, label, lines, valueColor, align = "left",
  labelStart = 10, labelMin = 8, lineStart = 15, lineMin = 11, gap = 5
}) {
  ctx.textAlign = align;
  const textX = align === "left" ? x + padX : x + w / 2;
  const maxW = w - padX * 2;

  const labelText = label.toUpperCase();
  const labelSize = fitFontSize(ctx, labelText, maxW, labelStart, labelMin, "-Bold");
  const labelStr = truncateToFit(ctx, labelText, maxW);

  const line1Text = formatValue(lines[0]);
  const line1Size = fitFontSize(ctx, line1Text, maxW, lineStart, lineMin, "-Bold");
  const line1Str = truncateToFit(ctx, line1Text, maxW);

  const line2Text = formatValue(lines[1]);
  const line2Size = fitFontSize(ctx, line2Text, maxW, lineStart, lineMin, "-Bold");
  const line2Str = truncateToFit(ctx, line2Text, maxW);

  const blockH = labelSize + gap + line1Size + gap + line2Size;
  const startY = y + (h - blockH) / 2;

  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = `${labelSize}px "${FONT_FAMILY}-Bold"`;
  ctx.fillText(labelStr, textX, startY);

  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = `${line1Size}px "${FONT_FAMILY}-Bold"`;
  ctx.fillText(line1Str, textX, startY + labelSize + gap);

  ctx.fillStyle = valueColor || COLORS.textPrimary;
  ctx.font = `${line2Size}px "${FONT_FAMILY}-Bold"`;
  ctx.fillText(line2Str, textX, startY + labelSize + gap + line1Size + gap);
  ctx.textAlign = "left";
}

/**
 * Renders a dark, branded stats card as a PNG buffer. The uploaded logo
 * image is drawn as the full poster-style background, with a dark overlay
 * underneath the text so stats stay readable.
 *
 * @param {Object} opts
 * @param {string} opts.title - Main heading (e.g. "PopDEX Wallet — 0xAb12...9f3d")
 * @param {string} [opts.subtitle] - Smaller line under the title
 * @param {Array<{label: string, value: string, color?: string, wide?: boolean, half?: boolean, hero?: boolean, lines?: [string, string], center?: boolean}>} opts.rows - Stat rows.
 *   Plain rows sit in a left-aligned grid. `wide: true` rows take the full
 *   row by themselves (left-aligned by default — add `center: true` to
 *   center the label/value instead, e.g. for a highlighted full-width
 *   stat that isn't a "position"). `half: true` position rows pair up
 *   two-per-row (used once there are more open positions than fit
 *   comfortably as full-width rows, or to sit two related stats side by
 *   side). A `wide` or `half` row can optionally pass `lines: [line1,
 *   line2]` instead of (or in addition to) `value` — renders as three
 *   explicit stacked lines (label, then line1, then line2, e.g.
 *   pair+leverage on one line and ROE on the next) rather than the usual
 *   label+value pair. When two `half` rows are paired and one uses
 *   `lines`, both boxes share the taller stacked height so they still
 *   line up. `hero: true` rows get the big centered headline-box treatment
 *   (e.g. Account Equity, Referral Code); add `half: true` alongside
 *   `hero: true` (or alongside an "achievement"-labelled row) to pair two
 *   headline boxes side by side instead of each taking the full width. A
 *   row whose label contains "achievement" always gets the gold
 *   highlighted/big-text treatment, full-width by default or half-width
 *   when paired with a `hero + half` row.
 * @param {number} [opts.chipCols] - Override the auto-computed column count
 *   for plain (non-hero/wide/half) stat chips, e.g. to force a single
 *   compact row of small boxes instead of a stretched 2-column grid.
 * @param {number} [opts.contentWidthRatio] - Override how much of the card's
 *   width the stat grid uses (default 0.68, leaving ~32% clear on the right
 *   for background art). Pass e.g. 0.9 to use nearly the full width (only
 *   ~10% clear) when a card has a dense, uniform grid and no art to protect.
 * @param {number} [opts.scale] - Uniformly enlarges the whole poster (default
 *   1 = unchanged). Everything — canvas resolution, text, boxes, gaps,
 *   corner radii, the background art — grows together by this factor, since
 *   it's applied as a single canvas transform rather than by resizing
 *   individual elements. Pass e.g. 1.3 for a 30% bigger poster.
 * @param {number} [opts.heroValueStart] - Starting font size for a hero/
 *   featured row's big value text (default 46). Shrinks automatically down
 *   to heroValueMin if the text is too wide for the box.
 * @param {number} [opts.heroValueMin] - Smallest the hero value text is
 *   allowed to shrink to before truncating with an ellipsis (default 24).
 * @param {string} [opts.footer] - Footer text
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function renderStatsCard({
  title, subtitle, rows, footer = "Trade on app.popdex.xyz",
  chipCols, contentWidthRatio = 0.68, chipColGap,
  chipHeight, chipLabelStart, chipValueStart, chipStackedLabelStart, chipStackedLineStart,
  titleFontSize, subtitleGap, headerBottomGap, scale = 1,
  heroValueStart, heroValueMin
}) {
  const width = 1080;              // wider than tall on purpose — landscape ~2:1 format
                                    // (widened from 900 -> 1080) so the 3-column chip grid
                                    // gets real breathing room and long "position" row values
                                    // (symbol / side / leverage / ROE, etc.) have room to fit
                                    // on one line before the two-line wrap fallback kicks in.
  // Header geometry. All derived from the actual title font size (instead
  // of a flat constant) so a bigger titleFontSize automatically pushes the
  // subtitle (wallet address) and the grid down instead of overlapping
  // them. titleY/effectiveTitleSize/SUBTITLE_GAP/HEADER_BOTTOM_GAP default
  // to exactly the values that reproduce the original fixed header (title
  // y=26, subtitle y=58, divider y=70, grid starts y=90) when no caller
  // passes titleFontSize/subtitleGap/headerBottomGap — so every existing
  // card that doesn't opt in renders pixel-identical to before.
  const titleY = 26;
  const effectiveTitleSize = titleFontSize != null ? titleFontSize : 26;
  const SUBTITLE_GAP = subtitleGap != null ? subtitleGap : 6;   // gap between title and subtitle
  const subtitleY = titleY + effectiveTitleSize + SUBTITLE_GAP;
  const subtitleFontSize = 14;
  const HEADER_BOTTOM_GAP = headerBottomGap != null ? headerBottomGap : 18; // gap between subtitle and the stat grid
  const headerHeight = subtitleY + subtitleFontSize + HEADER_BOTTOM_GAP - 14; // kept so "headerHeight + 14" below still lines up with gridStartY
  const footerHeight = 40;

  // Row heights. Only ONE thing on this card gets the big/highlighted
  // treatment: achievements. Everything else — including Account
  // Equity — is a small, flat, plain-text row. No other row gets a
  // background box or border.
  const cellH = chipHeight != null ? chipHeight : 50;          // small stat chips (Account Equity, Unrealized PnL, Available Margin, 7D Volume, 7D Trades)
  const positionRowH = 44;   // Largest Position — small, plain
  const achievementH = 92;   // Achievements — the ONE highlighted, big-text row
  const featuredH = 140;     // Featured hero stat (e.g. Referral Code, Total 24H Volume) — centered, blue-accented
  const rowGap = 10;
  const sectionGap = 24;     // extra gap + divider line between different sections
  // Horizontal gap between chip columns only. Defaults to rowGap (10px,
  // identical to every other spacing on the card) so existing callers are
  // unaffected. A caller can pass a smaller chipColGap to shrink just the
  // gutter between chip boxes, which widens each box (row height/vertical
  // spacing is untouched either way).
  const CHIP_COL_GAP = chipColGap != null ? chipColGap : rowGap;

  const gridX = 36;
  // Keep the stat grid to the left portion of the card instead of
  // stretching edge-to-edge — leaves the right ~30% of the panel clear so
  // the background art actually shows through instead of getting buried
  // under boxes.
  const CONTENT_WIDTH_RATIO = contentWidthRatio;
  const contentW = (width - gridX * 2) * CONTENT_WIDTH_RATIO;

  // The achievements row is identified by its label (set by
  // performance.js), not by how many badges it happens to contain — a
  // wallet with only one badge should still get the highlighted
  // treatment, not fall back to a plain row.
  function isAchievementRow(row) {
    return typeof row.label === "string" &&
      row.label.toLowerCase().includes("achievement");
  }
  // A "featured" row is a single hero stat — e.g. a referral code, or a
  // "Total 24H Volume" headline — rendered as a big centered value inside
  // a themed box. Callers opt in with `hero: true` on the row
  // (referral.js, market.js, performance.js all use this flag name).
  // Distinct from the achievement row (gold, multi-badge) and from
  // position rows (small, left-aligned, colored side-bar).
  function isFeaturedRow(row) {
    return row.hero === true;
  }
  // A hero row or an achievement row can optionally be paired side-by-side
  // with another such row by also setting `half: true` — e.g. Account
  // Equity sitting next to the Achievements badges box. Falls back to the
  // normal full-width treatment when `half` isn't set.
  function isHeroPairRow(row) {
    return row.half === true && (isFeaturedRow(row) || isAchievementRow(row));
  }
  function sectionOf(row) {
    if (isHeroPairRow(row)) return "heroPair";
    if (isAchievementRow(row)) return "achievement";
    if (isFeaturedRow(row)) return "featured";
    if (row.wide || row.half) return "position";
    return "chip"; // plain small stat tile
  }

  const chipRows = rows.filter(r => sectionOf(r) === "chip");
  const cols = chipCols || (chipRows.length <= 2 ? Math.max(chipRows.length, 1) : chipRows.length === 4 ? 2 : 3);
  const cellW = (contentW - CHIP_COL_GAP * (cols - 1)) / cols;
  const halfW = (contentW - rowGap) / 2;

  // Measurement-only canvas so we can check whether a wide position row's
  // value text fits before the real canvas (whose height depends on this)
  // is created. Position rows use a 10px minimum font (see the drawCellText
  // call further down) — that's the size checked here.
  const measureCanvas = createCanvas(10, 10);
  const mctx = measureCanvas.getContext("2d");
  const POSITION_VALUE_MIN = 10;
  const POSITION_PAD_X = 14;
  const WRAP_EXTRA_H = 20;  // extra box height to fit a second (wrapped) value line
  const STACK_EXTRA_H = 22; // extra box height for an explicit 3-line stacked row (label + 2 lines)

  function wideValueNeedsWrap(value, boxW) {
    mctx.font = `${POSITION_VALUE_MIN}px "${FONT_FAMILY}-Bold"`;
    const maxW = boxW - POSITION_PAD_X * 2;
    return mctx.measureText(formatValue(value)).width > maxW;
  }

  // Shared height rule for any wide/half "position"-style box: an explicit
  // 3-line stacked row (lines: [a, b]) always gets the taller stacked
  // height; otherwise it's the normal row height, bumped only if the
  // single value needs the two-line wrap fallback.
  function positionBoxHeight(row, boxW) {
    if (Array.isArray(row.lines) && row.lines.length === 2) return positionRowH + STACK_EXTRA_H;
    if (wideValueNeedsWrap(row.value, boxW)) return positionRowH + WRAP_EXTRA_H;
    return positionRowH;
  }

  // Compute each row's box (and divider positions) before creating the
  // canvas, so the canvas height accounts for exactly what's needed.
  const items = [];
  let colIndex = 0;
  let halfColIndex = 0;
  let heroPairColIndex = 0;
  let halfPairH = positionRowH;
  let curY = headerHeight + 14;
  let curSection = null;

  rows.forEach((row, idx, arr) => {
    const section = sectionOf(row);
    if (section !== curSection) {
      if (curSection === "chip" && colIndex > 0) { curY += cellH + rowGap; colIndex = 0; }
      if (curSection === "position" && halfColIndex > 0) { curY += halfPairH + rowGap; halfColIndex = 0; }
      if (curSection === "heroPair" && heroPairColIndex > 0) { curY += featuredH + rowGap; heroPairColIndex = 0; }
      // A thin divider marks the boundary between sections — the
      // "part by part" separation instead of one continuous grid.
      if (curSection !== null) {
        items.push({ divider: true, y: curY + (sectionGap - rowGap) / 2 });
        curY += sectionGap - rowGap;
      }
      curSection = section;
    }

    if (section === "heroPair") {
      const x = gridX + heroPairColIndex * (halfW + rowGap);
      items.push({ row, x, y: curY, w: halfW, h: featuredH });
      heroPairColIndex++;
      if (heroPairColIndex >= 2) { heroPairColIndex = 0; curY += featuredH + rowGap; }
    } else if (section === "achievement") {
      items.push({ row, x: gridX, y: curY, w: contentW, h: achievementH });
      curY += achievementH + rowGap;
    } else if (section === "featured") {
      items.push({ row, x: gridX, y: curY, w: contentW, h: featuredH });
      curY += featuredH + rowGap;
    } else if (row.half) {
      if (halfColIndex === 0) {
        const partner = arr[idx + 1];
        const partnerIsHalfPeer = partner && !partner.hero && !isAchievementRow(partner) && partner.half && !partner.wide;
        halfPairH = partnerIsHalfPeer
          ? Math.max(positionBoxHeight(row, halfW), positionBoxHeight(partner, halfW))
          : positionBoxHeight(row, halfW);
      }
      const x = gridX + halfColIndex * (halfW + rowGap);
      items.push({ row, x, y: curY, w: halfW, h: halfPairH, stacked: Array.isArray(row.lines) && row.lines.length === 2 });
      halfColIndex++;
      if (halfColIndex >= 2) { halfColIndex = 0; curY += halfPairH + rowGap; }
    } else if (row.wide) {
      const stacked = Array.isArray(row.lines) && row.lines.length === 2;
      const wrap = !stacked && wideValueNeedsWrap(row.value, contentW);
      const h = positionBoxHeight(row, contentW);
      items.push({ row, x: gridX, y: curY, w: contentW, h, wrap, stacked });
      curY += h + rowGap;
    } else {
      const x = gridX + colIndex * (cellW + CHIP_COL_GAP);
      items.push({ row, x, y: curY, w: cellW, h: cellH, stacked: Array.isArray(row.lines) && row.lines.length === 2 });
      colIndex++;
      if (colIndex >= cols) { colIndex = 0; curY += cellH + rowGap; }
    }
  });
  if (curSection === "chip" && colIndex > 0) curY += cellH + rowGap;
  if (curSection === "position" && halfColIndex > 0) curY += halfPairH + rowGap;
  if (curSection === "heroPair" && heroPairColIndex > 0) curY += featuredH + rowGap;

  const height = curY + footerHeight + 20;

  // Everything above this point (width, height, every row's x/y/w/h) is
  // computed in the original "logical" pixel space, unaffected by scale.
  // The canvas itself is created at the scaled-up resolution, and one
  // ctx.scale() call before any drawing happens means every fillRect,
  // fillText, roundRect, font size, and gap below — none of which needed
  // to change — paints enlarged by the same factor, in proportion.
  const canvas = createCanvas(Math.round(width * scale), Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  const panelX = 14, panelY = 14, panelW = width - 28, panelH = height - 28;

  const bg = await getBackgroundImage();

  ctx.save();
  roundRect(ctx, panelX, panelY, panelW, panelH, 20);
  ctx.clip();

  if (bg) {
    drawImageCover(ctx, bg, panelX, panelY, panelW, panelH);
    const grad = ctx.createLinearGradient(0, panelY, 0, panelY + panelH);
    grad.addColorStop(0, `rgba(10, 10, 12, ${Math.min(OVERLAY_OPACITY + 0.1, 1)})`);
    grad.addColorStop(0.45, `rgba(13, 13, 15, ${OVERLAY_OPACITY * 0.82})`);
    grad.addColorStop(1, `rgba(8, 8, 10, ${Math.min(OVERLAY_OPACITY + 0.12, 1)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(panelX, panelY, panelW, panelH);
  } else {
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(panelX, panelY, panelW, panelH);
  }

  ctx.restore();

  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  roundRect(ctx, panelX, panelY, panelW, panelH, 20);
  ctx.stroke();

  const textStartX = 36;
  ctx.textBaseline = "top";

  ctx.fillStyle = COLORS.accent;
  roundRect(ctx, textStartX, 30, 4, 24, 2);
  ctx.fill();

  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = `${effectiveTitleSize}px "${FONT_FAMILY}-Bold"`;
  ctx.textAlign = "left";
  ctx.fillText(title, textStartX + 14, titleY);

  if (subtitle) {
    ctx.fillStyle = COLORS.textSecondary;
    ctx.font = `${subtitleFontSize}px "${FONT_FAMILY}"`;
    ctx.fillText(subtitle, textStartX + 14, subtitleY);
  }

  ctx.strokeStyle = COLORS.border;
  ctx.beginPath();
  ctx.moveTo(36, headerHeight - 6);
  ctx.lineTo(width - 36, headerHeight - 6);
  ctx.stroke();

  // Draw each row/divider using its precomputed box. Every row is plain,
  // flat, left-aligned text directly on the poster background — no box,
  // no border, no fill — EXCEPT the achievements row, which is the one
  // place that gets a highlighted box and big bold text.
  items.forEach(item => {
    if (item.divider) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gridX, item.y);
      ctx.lineTo(width - gridX, item.y);
      ctx.stroke();
      return;
    }

    const { row, x, y, w, h, wrap } = item;

    if (isAchievementRow(row)) {
      // THE highlighted element on the card — bordered box, subtle gold
      // fill, big bold gold text. Everything else on the card is plain
      // specifically so this is the thing your eye lands on.
      ctx.fillStyle = "rgba(251, 191, 36, 0.09)";
      roundRect(ctx, x, y, w, h, 16);
      ctx.fill();
      ctx.strokeStyle = "rgba(251, 191, 36, 0.5)";
      ctx.lineWidth = 1.5;
      roundRect(ctx, x, y, w, h, 16);
      ctx.stroke();

      const badges = String(row.value).split("·").map(s => s.trim()).filter(Boolean).join("   ·   ");
      const padX = 22;
      ctx.textAlign = "left";

      // Same vertical rhythm as the Account Equity hero box next to it
      // (label baseline at y+40, value baseline at y+68) so the two
      // paired boxes line up instead of the achievement text sitting at
      // a different height.
      ctx.fillStyle = COLORS.gold;
      ctx.font = `11px "${FONT_FAMILY}-Bold"`;
      ctx.fillText(row.label.toUpperCase(), x + padX, y + 40);

      ctx.fillStyle = COLORS.gold;
      const size = fitFontSize(ctx, badges, w - padX * 2, 34, 18, "-Bold");
      ctx.fillText(truncateToFit(ctx, badges, w - padX * 2), x + padX, y + 68);
      return;
    }

    if (isFeaturedRow(row)) {
      // The hero stat box — e.g. "REFERRAL CODE" / "HIMU7214" or
      // "TOTAL 24H VOLUME" / "$21.13M". Neutral gray-accented (matches
      // the plain stat boxes elsewhere on the card) rather than blue,
      // just a touch stronger since it's the headline stat. Everything
      // centered, matching the target reference cards.
      ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
      roundRect(ctx, x, y, w, h, 16);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.20)";
      ctx.lineWidth = 1.5;
      roundRect(ctx, x, y, w, h, 16);
      ctx.stroke();

      const cx = x + w / 2;
      ctx.textAlign = "center";

      // Short center-line accent above the label
      const lineW = 40;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - lineW / 2, y + 26);
      ctx.lineTo(cx + lineW / 2, y + 26);
      ctx.stroke();

      ctx.fillStyle = COLORS.textSecondary;
      ctx.font = `11px "${FONT_FAMILY}-Bold"`;
      ctx.fillText(row.label.toUpperCase(), cx, y + 40);

      const valueText = formatValue(row.value);
      ctx.fillStyle = row.color || COLORS.textPrimary;
      ctx.shadowColor = "rgba(255, 255, 255, 0.35)";
      ctx.shadowBlur = 18;
      const valSize = fitFontSize(
        ctx, valueText, w - 48,
        heroValueStart != null ? heroValueStart : 46,
        heroValueMin != null ? heroValueMin : 24,
        "-Bold"
      );
      ctx.fillText(truncateToFit(ctx, valueText, w - 48), cx, y + 68);
      ctx.shadowBlur = 0;

      ctx.textAlign = "left";
      return;
    }

    // Every row gets a subtle bordered box behind it — visible in every
    // reference card (chips AND position rows). Position rows additionally
    // get a colored left accent bar so LONG/SHORT PnL color reads at a
    // glance, drawn on top of the box.
    const isPositionRow = row.wide || row.half;

    ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
    roundRect(ctx, x, y, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, 14);
    ctx.stroke();

    if (isPositionRow) {
      ctx.fillStyle = row.color || COLORS.accent;
      roundRect(ctx, x, y, 3, h, 1.5);
      ctx.fill();
    }

    if (isPositionRow && item.stacked) {
      drawCellTextStacked(ctx, {
        x, y, w, h,
        padX: 14,
        label: row.label,
        lines: row.lines,
        valueColor: row.color,
        align: "left",
        labelStart: 10, labelMin: 8, lineStart: 15, lineMin: 11, gap: 5
      });
    } else if (!isPositionRow && item.stacked) {
      // A plain grid chip that has explicit `lines` instead of a single
      // `value` (e.g. Largest Position sized to match every other chip) —
      // same 3-line treatment as the position-row case, just centered and
      // scaled down to fit the smaller chip cell instead of the taller,
      // left-aligned position box.
      drawCellTextStacked(ctx, {
        x, y, w, h,
        padX: 16,
        label: row.label,
        lines: row.lines,
        valueColor: row.color,
        align: "center",
        labelStart: chipStackedLabelStart != null ? chipStackedLabelStart : 8,
        labelMin: 6,
        lineStart: chipStackedLineStart != null ? chipStackedLineStart : 11,
        lineMin: 8,
        gap: 3
      });
    } else if (isPositionRow && wrap) {
      // Value didn't fit on one line even at the minimum font size (see
      // wideValueNeedsWrap at layout time) — drop to a second line instead
      // of truncating with an ellipsis, so nothing is hidden.
      drawCellTextWrapped(ctx, {
        x, y, w, h,
        padX: 14,
        label: row.label,
        value: row.value,
        valueColor: row.color,
        labelSize: 10,
        valueSize: 10,
        gap: 5,
        lineGap: 4
      });
    } else {
      // row.align lets a plain chip row (not wide/half) opt into
      // left-alignment on its own — independent of isPositionRow — so it
      // can still use chipLabelStart/chipValueStart sizing instead of
      // being forced to the fixed 10/15 position-row sizes.
      const align = row.align || (row.center ? "center" : (isPositionRow ? "left" : "center"));
      drawCellText(ctx, {
        x, y, w, h,
        align,
        padX: align === "center" ? 16 : 14,
        label: row.label,
        value: row.value,
        valueColor: row.color,
        labelStart: isPositionRow ? 10 : (chipLabelStart != null ? chipLabelStart : 9),
        labelMin: 7,
        valueStart: isPositionRow ? 15 : (chipValueStart != null ? chipValueStart : 13),
        valueMin: 10,
        gap: 5
      });
    }
  });
  ctx.textAlign = "left";

  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = `12px "${FONT_FAMILY}"`;
  ctx.textAlign = "center";
  ctx.fillText(footer, width / 2, height - 28);
  ctx.textAlign = "left";

  return canvas.encode("png");
}

/**
 * Renders a single-position "poster" card: PopDEX header (same as the other
 * cards, with the background art + accent tick), a pill badge for the pair/
 * side/leverage, then a big bold PNL% headline with the mark price
 * underneath. The PNL% has no boxed/highlighted background behind it — it's
 * just large bold text sitting directly on the poster background.
 *
 * @param {Object} opts
 * @param {string} opts.symbol - e.g. "BTCUSDT"
 * @param {string} [opts.side] - "LONG" / "SHORT" (or whatever the API calls it)
 * @param {string|number} [opts.leverage] - e.g. 10 (rendered as "10x")
 * @param {number} opts.pnlPercent - signed ROI percent, e.g. 42.35 or -8.2
 * @param {string} opts.markPrice - already-formatted current/mark price, e.g. "$64,210.55"
 * @param {string} [opts.referralCode] - wallet's own referral code, shown as a second
 *   column right beside Mark Price (same font size as the price value). Omitted entirely when not passed.
 * @param {string} [opts.footer]
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function renderPositionCard({ symbol, side, leverage, pnlPercent, markPrice, referralCode, footer = "" }) {
  const width = 700;
  const height = 390;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Base background (shows if the image fails to load)
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  const panelX = 14, panelY = 14, panelW = width - 28, panelH = height - 28;

  // Panel — same treatment as renderStatsCard: clip to rounded rect, draw
  // the background image "cover" style, then a dark gradient overlay.
  const bg = await getBackgroundImage();

  ctx.save();
  roundRect(ctx, panelX, panelY, panelW, panelH, 20);
  ctx.clip();

  if (bg) {
    drawImageCover(ctx, bg, panelX, panelY, panelW, panelH);
    const grad = ctx.createLinearGradient(0, panelY, 0, panelY + panelH);
    grad.addColorStop(0, `rgba(10, 10, 12, ${Math.min(OVERLAY_OPACITY + 0.1, 1)})`);
    grad.addColorStop(0.45, `rgba(13, 13, 15, ${OVERLAY_OPACITY * 0.82})`);
    grad.addColorStop(1, `rgba(8, 8, 10, ${Math.min(OVERLAY_OPACITY + 0.12, 1)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(panelX, panelY, panelW, panelH);
  } else {
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(panelX, panelY, panelW, panelH);
  }

  ctx.restore();

  // Panel border
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  roundRect(ctx, panelX, panelY, panelW, panelH, 20);
  ctx.stroke();

  const textStartX = 40;
  const maxTextWidth = panelW - (textStartX - panelX) - 40;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  // --- Header: accent tick + "PopDEX" title, same as the other cards ---
  ctx.fillStyle = COLORS.accent;
  roundRect(ctx, textStartX, 30, 4, 24, 2);
  ctx.fill();

  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = `26px "${FONT_FAMILY}-Bold"`;
  ctx.fillText("PopDEX", textStartX + 14, 26);

  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = `14px "${FONT_FAMILY}"`;
  ctx.fillText("Position", textStartX + 14, 58);

  // Divider under header
  ctx.strokeStyle = COLORS.border;
  ctx.beginPath();
  ctx.moveTo(textStartX, 88);
  ctx.lineTo(width - textStartX, 88);
  ctx.stroke();

  // --- Pill badge: "SYMBOL · SIDE · Nx" ---
  const badgeParts = [symbol, side, leverage != null ? `${leverage}x` : null].filter(Boolean);
  const badgeText = badgeParts.join("  ·  ");
  ctx.font = `15px "${FONT_FAMILY}-Bold"`;
  const badgeTextW = ctx.measureText(truncateToFit(ctx, badgeText, maxTextWidth - 40)).width;
  const badgePadX = 20;
  const badgeH = 40;
  const badgeW = badgeTextW + badgePadX * 2;
  const badgeY = 112;

  ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
  roundRect(ctx, textStartX, badgeY, badgeW, badgeH, badgeH / 2);
  ctx.fill();

  ctx.fillStyle = COLORS.textPrimary;
  ctx.fillText(truncateToFit(ctx, badgeText, maxTextWidth - 40), textStartX + badgePadX, badgeY + badgeH / 2 - 8);

  // --- PROFIT / LOSS label + big % — plain bold text, no box behind it ---
  let contentY = badgeY + badgeH + 20;

  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = `13px "${FONT_FAMILY}-Bold"`;
  ctx.fillText("PROFIT / LOSS", textStartX, contentY);
  contentY += 30;

  const pnlColor = pnlPercent >= 0 ? COLORS.positive : COLORS.negative;
  const sign = pnlPercent >= 0 ? "+" : "";
  const pnlText = `${sign}${formatValue(pnlPercent.toFixed(2))}%`;

  ctx.fillStyle = pnlColor;
  const pnlFontSize = fitFontSize(ctx, pnlText, maxTextWidth, 76, 40, "-Bold");
  ctx.font = `${pnlFontSize}px "${FONT_FAMILY}-Bold"`;
  ctx.fillText(truncateToFit(ctx, pnlText, maxTextWidth), textStartX, contentY);
  contentY += pnlFontSize + 22;

  // --- Mark price — smaller, sits below the PNL headline. When a
  // referral code is available it sits in a second column right beside
  // the price — positioned just past the price value's actual width
  // (not a fixed half-width split), so it sits close and reads as one
  // grouped line rather than being pushed out toward the right edge.
  // Both columns share the exact same font size, computed to fit
  // whichever of the two values is longer. ---
  const priceText = formatValue(markPrice);
  let sharedFontSize = fitFontSize(ctx, priceText, maxTextWidth * 0.62, 30, 20, "-Bold");
  if (referralCode) {
    const refFontSize = fitFontSize(ctx, referralCode, maxTextWidth * 0.38, 30, 20, "-Bold");
    sharedFontSize = Math.min(sharedFontSize, refFontSize);
  }
  ctx.font = `${sharedFontSize}px "${FONT_FAMILY}-Bold"`;

  const priceDisplay = truncateToFit(ctx, priceText, maxTextWidth * 0.62);
  const priceTextWidth = ctx.measureText(priceDisplay).width;
  const colGap = 46;
  const refX = textStartX + priceTextWidth + colGap;
  const refMaxWidth = width - textStartX - 40 - refX;

  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = `13px "${FONT_FAMILY}-Bold"`;
  ctx.fillText("MARK PRICE", textStartX, contentY);
  if (referralCode) {
    ctx.fillText("REFERRAL CODE", refX, contentY);
  }
  contentY += 26;

  ctx.font = `${sharedFontSize}px "${FONT_FAMILY}-Bold"`;
  ctx.fillStyle = COLORS.textPrimary;
  ctx.fillText(priceDisplay, textStartX, contentY);
  if (referralCode) {
    ctx.fillText(truncateToFit(ctx, referralCode, refMaxWidth), refX, contentY);
  }

  // Footer — centered, same as the stat cards. Omitted entirely when no
  // footer text is passed in (empty by default for this card).
  if (footer) {
    ctx.fillStyle = COLORS.textSecondary;
    ctx.font = `12px "${FONT_FAMILY}"`;
    ctx.textAlign = "center";
    ctx.fillText(footer, width / 2, height - 30);
    ctx.textAlign = "left";
  }

  return canvas.encode("png");
}

module.exports = { renderStatsCard, renderPositionCard, COLORS };