'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

const FILE = path.join(config.paths.data, 'listing-tracker.json');
const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;

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
 * Marks a symbol as "gone live" the first time it's observed with a
 * listing_live classification. Idempotent — subsequent calls are no-ops.
 */
function markLiveIfNew(symbol) {
  if (!symbol) return;
  const data = load();
  if (!data[symbol]) {
    data[symbol] = { liveAt: Date.now() };
    save(data);
  }
}

/**
 * A symbol is still within the "New Listing" tracking window if it went
 * live less than 72 hours ago. Symbols never marked live (still upcoming
 * or plain general news) are treated as not-in-window.
 */
function isWithinTrackingWindow(symbol) {
  if (!symbol) return false;
  const data = load();
  const entry = data[symbol];
  if (!entry) return false;
  return Date.now() - entry.liveAt < SEVENTY_TWO_HOURS_MS;
}

function getLiveAt(symbol) {
  const data = load();
  return data[symbol]?.liveAt || null;
}

module.exports = { markLiveIfNew, isWithinTrackingWindow, getLiveAt };
