'use strict';

const { get } = require('./client');
const metricHistory = require('../utils/metricHistory');

const FUTURES = 'Futures';

/**
 * getMarketBySymbol(symbol)
 * Real endpoint: GET /api/v1/public/market/tickers?category=Futures&symbol=X
 * Gives price, 24h change, 24h volume, OI, funding rate, 24h high/low.
 */
async function getMarketBySymbol(symbol) {
  const body = await get('/api/v1/public/market/tickers', {
    params: { category: FUTURES, symbol },
  });
  const ticker = Array.isArray(body.data) ? body.data[0] : body.data;
  if (!ticker) return null;
  return ticker;
}

/**
 * getMarket()
 * All Futures tickers — used when no coin is specified (e.g. by /pulse, /oi).
 * Real endpoint: GET /api/v1/public/market/tickers?category=Futures
 */
async function getMarket({ limit = 100, cursor } = {}) {
  const body = await get('/api/v1/public/market/tickers', {
    params: { category: FUTURES, limit, cursor },
  });
  return Array.isArray(body.data) ? body.data : [];
}

/**
 * getVolume()
 * Total platform 24H volume only (never all-time volume), derived by
 * summing turnover24h across all Futures tickers.
 * Real endpoint: GET /api/v1/public/market/tickers?category=Futures
 */
async function getVolume() {
  const tickers = await getMarket({ limit: 100 });
  const total24h = tickers.reduce((sum, t) => sum + Number(t.turnover24h || 0), 0);
  // The API has no rolling volume-delta feed, so "how much has 24H
  // platform volume itself moved" is derived from our own snapshots
  // (see metricHistory.js) — null (rendered as "—") until a snapshot
  // from ~24h ago exists, never a fabricated number.
  const change24h = metricHistory.recordAndGetChange('volume:platform', total24h);
  return { total24h, marketCount: tickers.length, change24h };
}

/**
 * getVolumeBySymbol(symbol)
 * Real endpoint: GET /api/v1/public/market/tickers?category=Futures&symbol=X
 * ticker.price24hPcnt already gives real 24H PRICE change from the API;
 * turnover24h itself has no delta feed, so we snapshot it the same way
 * getVolume() does, per-symbol.
 */
async function getVolumeBySymbol(symbol) {
  const ticker = await getMarketBySymbol(symbol);
  if (!ticker) return null;
  const volumeChange24h = metricHistory.recordAndGetChange(
    `volume:${symbol}`,
    Number(ticker.turnover24h || 0)
  );
  return { ...ticker, volumeChange24h };
}

/**
 * getOpenInterest()
 * Real endpoint: GET /api/v1/public/market/open-interest
 * The API does not expose 24H OI delta directly, so it's derived from our
 * own snapshots (see metricHistory.js): null/"—" until a snapshot from
 * ~24h ago is on file, never a fabricated number.
 */
async function getOpenInterest({ limit = 100 } = {}) {
  const body = await get('/api/v1/public/market/open-interest', { params: { limit } });
  const rows = Array.isArray(body.data) ? body.data : [];
  const totalOi = rows.reduce((sum, r) => sum + Number(r.openInterest || 0), 0);
  const top5 = [...rows]
    .sort((a, b) => Number(b.openInterest || 0) - Number(a.openInterest || 0))
    .slice(0, 5);
  const change24h = metricHistory.recordAndGetChange('oi:platform', totalOi);
  return { totalOi, top5, all: rows, change24h };
}

/**
 * getOpenInterestBySymbol(symbol)
 * Real endpoint: GET /api/v1/public/market/open-interest?symbol=X
 */
async function getOpenInterestBySymbol(symbol) {
  const body = await get('/api/v1/public/market/open-interest', { params: { symbol } });
  const row = Array.isArray(body.data) ? body.data[0] : body.data;
  if (!row) return null;
  const change24h = metricHistory.recordAndGetChange(
    `oi:${symbol}`,
    Number(row.openInterest || 0)
  );
  return { ...row, change24h };
}

// USD open interest for a ticker = contracts (ticker.openInterest) ×
// markPrice — the same formula the Market Card uses. Comparing raw
// ticker.openInterest across symbols is meaningless (it's a contract
// count, not a dollar value, and contract sizes/prices vary wildly
// between markets), which is why "biggest OI" previously looked wrong.
function oiUsd(ticker) {
  return Number(ticker?.openInterest || 0) * Number(ticker?.markPrice || ticker?.lastPrice || 0);
}

/**
 * getPulse()
 * Compact real-time snapshot built from the Futures tickers list:
 *  - top-volume market (max turnover24h)
 *  - biggest price mover (max |price24hPcnt|)
 *  - biggest 24h volume figure as a proxy for "volume movement"
 *    (the API has no rolling-volume-delta feed, so this uses turnover24h
 *    itself rather than fabricating a synthetic delta)
 *  - biggest OI market (max USD open interest — contracts × markPrice,
 *    not raw contract count, so it's actually comparable across symbols)
 */
async function getPulse() {
  const tickers = await getMarket({ limit: 100 });
  if (tickers.length === 0) return null;

  const topVolume = [...tickers].sort(
    (a, b) => Number(b.turnover24h || 0) - Number(a.turnover24h || 0)
  )[0];

  const biggestMover = [...tickers].sort(
    (a, b) => Math.abs(Number(b.price24hPcnt || 0)) - Math.abs(Number(a.price24hPcnt || 0))
  )[0];

  const biggestOiTicker = [...tickers].sort((a, b) => oiUsd(b) - oiUsd(a))[0];
  const biggestOiUsd = biggestOiTicker ? oiUsd(biggestOiTicker) : null;

  return { topVolume, biggestMover, biggestOiTicker, biggestOiUsd, tickers };
}

/**
 * getDailyMarketStats()
 * Everything the /news daily recap paragraph needs, all derived from the
 * real Futures tickers list (same source as /market, /pulse, /volume) —
 * no fabricated figures. Used to build a plain-language daily summary:
 * top gainer(s), total + top 24h volume, and the OI leader (USD, same
 * fix as getPulse — contracts × markPrice, not raw contract count).
 */
async function getDailyMarketStats() {
  const tickers = await getMarket({ limit: 100 });
  if (tickers.length === 0) return null;

  const byChange = [...tickers].sort(
    (a, b) => Number(b.price24hPcnt || 0) - Number(a.price24hPcnt || 0)
  );
  const topGainers = byChange.filter((t) => Number(t.price24hPcnt || 0) > 0).slice(0, 5);
  const topLoser = byChange[byChange.length - 1];

  const totalVolume24h = tickers.reduce((sum, t) => sum + Number(t.turnover24h || 0), 0);
  const topVolume = [...tickers].sort(
    (a, b) => Number(b.turnover24h || 0) - Number(a.turnover24h || 0)
  )[0];

  const oiLeader = [...tickers].sort((a, b) => oiUsd(b) - oiUsd(a))[0];
  const oiLeaderUsd = oiLeader ? oiUsd(oiLeader) : null;

  return { topGainers, topLoser, totalVolume24h, topVolume, oiLeader, oiLeaderUsd };
}

module.exports = {
  getMarket,
  getMarketBySymbol,
  getVolume,
  getVolumeBySymbol,
  getOpenInterest,
  getOpenInterestBySymbol,
  getPulse,
  getDailyMarketStats,
  oiUsd,
};