'use strict';

const { get } = require('./client');

/**
 * ADAPTER NOTE — /news relies on functionality that is not fully exposed by
 * the documented Popdex API. The docs only expose a generic Inbox Message
 * Feed (GET /web/v1/msg/station/feed, businessType=Announcement), not a
 * dedicated "new listing" or "market event" feed. Everything in this file is
 * therefore isolated behind this adapter so the real listings/events
 * endpoint can be swapped in later without touching card/command code —
 * update only the functions below.
 *
 * Current best-effort behavior: pull the public Announcement feed and
 * heuristically classify each message using its title/content text, plus
 * live ticker data for anything referencing a symbol. No coin names are
 * hard-coded — classification is driven entirely by API response content.
 */

const LISTING_KEYWORDS = ['new listing', 'will list', 'listing of', 'launches trading'];
const LIVE_KEYWORDS = ['is now live', 'trading is live', 'now open for trading'];

async function getRawAnnouncementFeed({ limit = 50, cursor } = {}) {
  const body = await get('/web/v1/msg/station/feed', {
    params: { businessType: 'Announcement', limit, cursor },
  });
  return { items: Array.isArray(body.data) ? body.data : [], cursor: body.cursor };
}

function classify(item) {
  const text = `${item.title || ''} ${item.content || ''}`.toLowerCase();
  if (LISTING_KEYWORDS.some((k) => text.includes(k))) return 'upcoming_listing';
  if (LIVE_KEYWORDS.some((k) => text.includes(k))) return 'listing_live';
  return 'general';
}

/**
 * Extracts a probable coin/pair symbol (e.g. "BTCUSDT") from free text via
 * pattern matching only — never a hard-coded list.
 */
function extractSymbol(text) {
  const match = /\b([A-Z0-9]{2,10}USDT?|[A-Z0-9]{2,10}USDC)\b/.exec(text || '');
  return match ? match[1] : null;
}

/**
 * getUpcomingListings()
 * Adapter-isolated (see note above). Filters the Announcement feed for
 * upcoming-listing language and returns it with countdown metadata if the
 * message includes a parseable future timestamp reference; otherwise the
 * card falls back to showing the announcement time only.
 */
async function getUpcomingListings() {
  const { items } = await getRawAnnouncementFeed({ limit: 50 });
  return items
    .map((item) => ({ ...item, symbol: extractSymbol(item.title || item.content) }))
    .filter((item) => classify(item) === 'upcoming_listing');
}

/**
 * getMarketEvents()
 * Adapter-isolated (see note above). Returns general market-news items
 * (post the upcoming/live listing phase) used by /news once an item is
 * older than ~72h from "listing_live" classification.
 */
async function getMarketEvents({ limit = 30 } = {}) {
  const { items } = await getRawAnnouncementFeed({ limit });
  return items
    .map((item) => ({ ...item, symbol: extractSymbol(item.title || item.content), category: classify(item) }))
    .filter((item, idx, arr) => arr.findIndex((x) => x.id === item.id) === idx); // de-dupe by id
}

/**
 * getLiquidationSummary()
 * ADAPTER STUB. The documented Popdex REST API does not expose a
 * liquidations feed — no 24h liquidation total, no long/short split, no
 * "biggest liquidation" figure. Per this codebase's rule against
 * fabricated market data, this returns null instead of inventing
 * numbers. The daily /news recap (commands/news.js) checks for a
 * non-null result and only adds the liquidation sentence when real data
 * is available. If Popdex adds/exposes a real liquidations endpoint,
 * wire it up here — nothing else needs to change.
 */
async function getLiquidationSummary() {
  return null;
}

module.exports = {
  getUpcomingListings,
  getMarketEvents,
  getRawAnnouncementFeed,
  getLiquidationSummary,
  classify,
  extractSymbol,
};
