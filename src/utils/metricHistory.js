'use strict';

/**
 * Lightweight on-disk snapshot store used to compute real 24H deltas for
 * metrics the Popdex API does not expose a rolling delta for (platform
 * open interest, platform volume). Every time a value is read, we record
 * a timestamped snapshot; the NEXT time we're asked for a 24H change we
 * look back for the snapshot closest to (now - 24h) and diff against it.
 *
 * This intentionally follows the same "never fabricate a number" rule the
 * rest of the codebase uses (see market.js / vault.js comments) — if no
 * snapshot old enough exists yet (e.g. bot was only just started), the
 * change is reported as `null` and the cards render "—" instead of a
 * made-up figure. Accuracy improves automatically as the bot stays up.
 *
 * Same JSON-file-in-data/ pattern as walletStore.js.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const FILE = path.join(config.paths.data, 'metric-history.json');

const WINDOW_MS = 24 * 60 * 60 * 1000;
// Keep a bit more than 24h of samples so we always have something to
// diff against; trims older points so the file doesn't grow forever.
const RETENTION_MS = WINDOW_MS + 60 * 60 * 1000;
// A snapshot older than this (but within retention) is "close enough" to
// 24h ago to diff against — avoids requiring an exact 24h-old sample.
const MATCH_TOLERANCE_MS = 30 * 60 * 1000;

function ensureFile() {
  if (!fs.existsSync(config.paths.data)) fs.mkdirSync(config.paths.data, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({}), 'utf8');
}

function load() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  ensureFile();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Records a value under `series` (e.g. 'oi:platform', 'oi:BTCUSDT',
 * 'volume:platform') and returns the 24H fractional change (e.g. 0.032 =
 * +3.2%) against the oldest-still-useful prior snapshot, or null if
 * nothing old enough is on file yet.
 */
function recordAndGetChange(series, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  const now = Date.now();
  const data = load();
  const points = Array.isArray(data[series]) ? data[series] : [];

  // Find the snapshot nearest to `now - 24h` (searching from oldest to
  // newest so we land on the first one inside tolerance).
  const targetTs = now - WINDOW_MS;
  let change = null;
  for (const p of points) {
    if (Math.abs(p.ts - targetTs) <= MATCH_TOLERANCE_MS && Number(p.v) !== 0) {
      change = (n - Number(p.v)) / Number(p.v);
      break;
    }
  }
  // Fallback: if nothing is within tolerance but we DO have a point
  // older than the window, use the oldest one on file so long-running
  // bots still show a (slightly imprecise) change rather than "—".
  if (change === null) {
    const oldest = points[0];
    if (oldest && now - oldest.ts >= WINDOW_MS - MATCH_TOLERANCE_MS && Number(oldest.v) !== 0) {
      change = (n - Number(oldest.v)) / Number(oldest.v);
    }
  }

  const pruned = points.filter((p) => now - p.ts <= RETENTION_MS);
  pruned.push({ ts: now, v: n });
  data[series] = pruned;
  save(data);

  return change;
}

module.exports = { recordAndGetChange };
