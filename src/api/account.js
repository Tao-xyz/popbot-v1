'use strict';

const { get } = require('./client');

/**
 * getOpenPositions(walletId)
 * Real endpoint: GET /api/v1/account/{walletId}/positions
 */
async function getOpenPositions(walletId) {
  const body = await get(`/api/v1/account/${walletId}/positions`);
  return Array.isArray(body.data) ? body.data : [];
}

// /performance accepts 7D / 30D / 90D / ALL. The account portfolio endpoint's
// supported windows are 24H / 7D / 1M / 6M / All, so we map to the nearest
// real window rather than inventing new ones.
const PERFORMANCE_WINDOW_MAP = {
  '7D': '7D',
  '30D': '1M',
  '90D': '6M',
  ALL: 'All',
};

/**
 * getPerformance(walletId, window)
 * window is one of 7D / 30D / 90D / ALL (mapped to the nearest Popdex window
 * for the portfolio call; drawdown is computed exactly for 7D/30D/90D from
 * equity history instead — see fetchExactWindowDrawdown).
 * Real endpoints:
 *   GET /api/v1/account/{walletId}/portfolio?scope=All&window=...
 *   GET /api/v1/account/{walletId}/history/positions   (for win rate / best-worst trade)
 *   GET /api/v1/account/{walletId}/history/portfolio   (equity snapshots, for exact drawdown)
 */
// A closed position's "when" — same field convention as order history
// (see interactions/ordersPagination.js, which uses updatedAt as the
// exit time), with graceful fallbacks so a slightly different field name
// on this endpoint doesn't just silently produce zero active days.
function closeTimeOf(p) {
  return Number(p.updatedAt ?? p.closeTime ?? p.closedAt ?? p.createdAt ?? p.openTime ?? NaN);
}

const WINDOW_DAYS = { '7D': 7, '30D': 30, '90D': 90, ALL: null };

/**
 * Distinct calendar days (UTC) on which at least one position closed,
 * within the given list — used for the "active days" stat on /performance.
 */
function countActiveDays(closedPositions) {
  const days = new Set();
  for (const p of closedPositions) {
    const t = closeTimeOf(p);
    if (Number.isFinite(t)) days.add(new Date(t).toISOString().slice(0, 10));
  }
  return days.size;
}

/**
 * True max drawdown (peak-to-trough) computed from real equity snapshots,
 * for an EXACT window — unlike portfolio.maxDrawdown, which only exists
 * for the API's own 24H/7D/1M/6M/All windows and has to be approximated
 * for 30D/90D (see PERFORMANCE_WINDOW_MAP).
 *
 * UNVERIFIED FIELD NAMES: the time/equity field names below are guesses
 * following this file's existing fallback convention (see closeTimeOf).
 * DEBUG logging below prints the raw shape of the first row plus the
 * final result, so a mismatch against Popdex's own displayed drawdown
 * can be diagnosed from real data instead of guessing further.
 */
function calcMaxDrawdown(rows, startTime) {
  // CONFIRMED (2026-08-23 debug output): each top-level "row" is a bucket
  // object, not a {time, equity} point. The real time-series lives in
  // row.accountValueHistory — an array of
  // [timestampMs, totalAccountValue, positionValue, ?, availableBalance]
  // entries. Using entry[1] (total account value = positionValue +
  // availableBalance, verified against the sample: 51.68 + 58.07 = 109.75)
  // as equity. Deduped by timestamp in case buckets overlap.
  const byTime = new Map();
  for (const row of rows) {
    const history = Array.isArray(row?.accountValueHistory) ? row.accountValueHistory : [];
    for (const entry of history) {
      const t = Number(entry[0]);
      const equity = Number(entry[1]);
      if (Number.isFinite(t) && Number.isFinite(equity)) byTime.set(t, equity);
    }
  }

  const series = Array.from(byTime, ([t, equity]) => ({ t, equity }))
    .filter((p) => !startTime || p.t >= startTime)
    .sort((a, b) => a.t - b.t);

  if (series.length < 2) {
    return null;
  }

  let peak = series[0].equity;
  let maxDrawdown = 0; // fraction, e.g. -0.184 for -18.4%
  for (const { equity } of series) {
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const dd = (equity - peak) / peak;
      if (dd < maxDrawdown) maxDrawdown = dd;
    }
  }
  return maxDrawdown;
}

/**
 * Wraps calcMaxDrawdown with the actual fetch. Never throws — if the
 * equity-history endpoint is missing, empty, or shaped differently than
 * assumed above, this returns null and the caller falls back to the
 * portfolio endpoint's approximate maxDrawdown instead of breaking the
 * whole /performance command.
 */
async function fetchExactWindowDrawdown(walletId, startTime) {
  try {
    const body = await get(`/api/v1/account/${walletId}/history/portfolio`, {
      params: { startTime },
    });
    const rows = Array.isArray(body.data) ? body.data : [];
    return calcMaxDrawdown(rows, startTime);
  } catch {
    return null;
  }
}

async function getPerformance(walletId, window = '7D') {
  const apiWindow = PERFORMANCE_WINDOW_MAP[window] || '7D';
  const windowDaysNum = WINDOW_DAYS[window];

  // startTime is aligned to a UTC midnight boundary (not `now` minus exact
  // ms) so the range covers exactly windowDays distinct calendar dates.
  // Anchoring to `now` instead — a mid-day timestamp — made a "7D" window
  // span parts of 8 different UTC dates (partial start day + 6 full days
  // + partial today), which is why activeDays could show as 8/7.
  let startTime;
  if (windowDaysNum) {
    const today = new Date();
    const todayUTCStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    startTime = todayUTCStart - (windowDaysNum - 1) * 24 * 60 * 60 * 1000;
  }

  // Only bother fetching equity history for bounded windows (7D/30D/90D) —
  // for ALL there's no approximation problem to solve (apiWindow is
  // already an exact match), so skip the extra request.
  const [portfolioBody, exactMaxDrawdown] = await Promise.all([
    get(`/api/v1/account/${walletId}/portfolio`, { params: { scope: 'All', window: apiWindow } }),
    windowDaysNum ? fetchExactWindowDrawdown(walletId, startTime) : Promise.resolve(null),
  ]);
  const portfolio = portfolioBody.data;

  let closedPositions = [];
  let cursor;
  // Page through closed positions (bounded to a sane number of pages).
  for (let page = 0; page < 10; page += 1) {
    const body = await get(`/api/v1/account/${walletId}/history/positions`, {
      params: { startTime, cursor, limit: 100 },
    });
    const rows = Array.isArray(body.data) ? body.data : [];
    closedPositions = closedPositions.concat(rows);
    if (!body.cursor || rows.length === 0) break;
    cursor = body.cursor;
  }

  const trades = closedPositions.length;
  const wins = closedPositions.filter((p) => Number(p.netProfit || p.realizedPnl || 0) > 0);
  const winRate = trades > 0 ? wins.length / trades : null;

  let bestTrade = null;
  let worstTrade = null;
  for (const p of closedPositions) {
    const pnl = Number(p.netProfit ?? p.realizedPnl ?? 0);
    if (!bestTrade || pnl > Number(bestTrade.netProfit ?? bestTrade.realizedPnl ?? 0)) bestTrade = p;
    if (!worstTrade || pnl < Number(worstTrade.netProfit ?? worstTrade.realizedPnl ?? 0)) worstTrade = p;
  }

  // Lifetime volume for the badge tier — always the real All-time scope,
  // independent of the window the user picked to *display*. Reuses the
  // window's own portfolio fetch when the user already asked for ALL, so
  // this never costs more than one extra request.
  const lifetimePortfolio =
    apiWindow === 'All' ? portfolio : (await get(`/api/v1/account/${walletId}/portfolio`, { params: { scope: 'All', window: 'All' } })).data;
  const lifetimeVolume = Number(lifetimePortfolio?.spotVolume || 0) + Number(lifetimePortfolio?.futuresVolume || 0);

  let finalMaxDrawdown = exactMaxDrawdown ?? portfolio?.maxDrawdown ?? null;

  // Normalize format: the card's formatter (fmt.pctFromFraction) expects a
  // fraction (-0.184 for -18.4%) and multiplies by 100 to display it. If a
  // source ever returns an already-whole percentage (-18.4 meaning -18.4%
  // directly), that would get multiplied by 100 again and show as -1840%.
  // A real max-drawdown fraction can never realistically fall below -100%
  // (-1), so anything with |value| > 1.5 is almost certainly already in
  // whole-percentage form — convert it down to a fraction here.
  if (finalMaxDrawdown !== null && Number.isFinite(Number(finalMaxDrawdown)) && Math.abs(Number(finalMaxDrawdown)) > 1.5) {
    finalMaxDrawdown = Number(finalMaxDrawdown) / 100;
  }

  return {
    window,
    apiWindow,
    windowDays: WINDOW_DAYS[window],
    portfolio,
    trades,
    winRate,
    bestTrade,
    worstTrade,
    activeDays: countActiveDays(closedPositions),
    lifetimeVolume,
    // Real exact-window drawdown when the equity-history calc succeeded;
    // otherwise falls back to the portfolio endpoint's approximate value
    // (exact for 7D/ALL, nearest-window for 30D/90D — see
    // PERFORMANCE_WINDOW_MAP). maxDrawdownExact tells the caller which one
    // it got, so the card can label an approximation honestly instead of
    // presenting it as exact.
    maxDrawdown: finalMaxDrawdown,
    maxDrawdownExact: exactMaxDrawdown !== null,
  };
}

/**
 * getOrderHistory(walletId, limit, cursor)
 * Real endpoint: GET /api/v1/account/{walletId}/history/orders
 * includeUnfilled=false so we only ever show completed orders.
 */
async function getOrderHistory(walletId, { limit = 10, cursor } = {}) {
  const body = await get(`/api/v1/account/${walletId}/history/orders`, {
    params: { limit, cursor, includeUnfilled: false },
  });
  return {
    orders: Array.isArray(body.data) ? body.data : [],
    cursor: body.cursor,
    total: body.total,
  };
}

module.exports = { getOpenPositions, getPerformance, getOrderHistory };