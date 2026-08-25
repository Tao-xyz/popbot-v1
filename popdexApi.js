const API_BASE = process.env.POPDEX_API_BASE || "https://api.popdex.xyz/api/v1";

// Simple in-memory cache to avoid hammering the API (shared IP rate limit: 1200 weight / 60s)
const cache = new Map();
const CACHE_TTL_MS = 30_000; // 30s

async function cachedFetch(path, { forceRefresh = false } = {}) {
  const cached = cache.get(path);
  if (!forceRefresh && cached && Date.now() - cached.time < CACHE_TTL_MS) {
    return cached.data;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" }
  });

  if (!res.ok) {
    throw new Error(`PopDEX API error ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  if (json.code !== "200") {
    throw new Error(json.msg || `PopDEX API returned code ${json.code}`);
  }

  cache.set(path, { data: json, time: Date.now() });
  return json;
}

function getOverview(wallet) {
  return cachedFetch(`/account/${wallet}/overview`);
}

function getPositions(wallet) {
  return cachedFetch(`/account/${wallet}/positions`);
}

function getSettings(wallet) {
  return cachedFetch(`/account/${wallet}/settings`);
}

function getEquityHistory(wallet) {
  return cachedFetch(`/account/${wallet}/history/portfolio`);
}

// NOTE: previously hardcoded `cursor=1`. A live test of the sibling
// /history/orders endpoint with cursor=1 returned `data: []` despite
// `total: "297"` — a real result set, just not on whatever page cursor=1
// pointed to. That strongly suggests this API's cursor isn't a 1-indexed
// page number the way the old default assumed. Cursor is now omitted by
// default (first-page behavior, matching the response's own empty-string
// `cursor` field on the first page) — pass one explicitly via a future
// `cursor` param if pagination is needed once the real scheme is confirmed.
function getClosedPositions(wallet, limit = 10) {
  return cachedFetch(`/account/${wallet}/history/positions?limit=${limit}`);
}

function getPortfolioPerformance(wallet, scope = "All", window = "7D") {
  return cachedFetch(`/account/${wallet}/portfolio?scope=${scope}&window=${window}`);
}

function getOpenInterest(symbol) {
  const q = symbol ? `?symbol=${symbol}` : "";
  return cachedFetch(`/public/market/open-interest${q}`);
}

// Confirmed via the live tracker page — one call returns 24h volume
// (turnover24h, in USD) AND open interest (openInterest, in BASE-ASSET
// units — multiply by lastPrice to get USD notional) for every pair.
//
// IMPORTANT: confirmed via /positions (which pulls live mark price straight
// from the account endpoint) that Rwa products like TECH100USDT ARE
// actively trading with real prices — but a plain
// `?category=Futures` call here does NOT include them. The Get Symbol
// Config endpoint (same API) exposes an `assetClass` filter (Crypto/Rwa),
// so `assetClass` is passed through here too — pass "Rwa" explicitly to
// pull real-world-asset pairs, since the default response appears to be
// Crypto-only.
function getMarketTickers(category = "Futures", assetClass) {
  const params = new URLSearchParams({ category });
  if (assetClass) params.set("assetClass", assetClass);
  return cachedFetch(`/public/market/tickers?${params.toString()}`);
}

// Targeted single-symbol ticker lookup — fallback for pairs that the bulk
// /public/market/tickers list silently drops. Confirmed via TRUMPUSDT
// (assetClass "Crypto", same as BTCUSDT/ETHUSDT which work fine) AND
// TECH100USDT (assetClass "Rwa") both missing from bulk — so this is NOT
// an assetClass filtering gap (that was an earlier, now-disproven theory).
// The root cause on the bulk endpoint is still unconfirmed (pagination
// default? listing-order cutoff? something else server-side) — rather
// than chase a fourth theory, this sidesteps it entirely.
//
// This endpoint's field shape (turnover24h, openInterest, category)
// mirrors Bybit's ticker API convention, which supports a `symbol` query
// param to fetch one instrument directly. ASSUMPTION (not yet confirmed
// live — api.popdex.xyz isn't reachable from this environment): PopDEX's
// endpoint accepts the same `symbol` param and returns the same shape as
// the bulk call, just scoped to one pair (data: [ {...} ] or data: {...}).
// If PopDEX's actual behavior differs, this is the one place to fix it.
function getSingleTicker(symbol, category = "Futures") {
  const params = new URLSearchParams({ category, symbol });
  return cachedFetch(`/public/market/tickers?${params.toString()}`);
}

// Order history — weight 20 per call (heaviest endpoint we hit), so lean
// on the shared 30s cache rather than polling this often. All optional
// filters are passed through as-is; omit a key in `opts` to skip it.
// opts: { orderId, symbol, category, orderType, side, sourceType,
//         startTime, endTime, cursor, limit, clientOid, includeUnfilled }
//
// CURSOR BUG FIX: this used to default cursor to 1. A live curl with
// cursor=1 returned `data: []` with `total: "297"` — real data exists,
// cursor=1 just isn't "page 1" the way that assumed. Now cursor is only
// sent if the caller explicitly provides one, matching how the API's own
// response represents "first page" (an empty-string cursor). PENDING: a
// retest with cursor omitted entirely (no `cursor` key on the querystring
// at all) will confirm whether that's what actually returns data — if
// it's still empty, the real pagination param/shape needs a fresh look.
function getOrderHistory(wallet, opts = {}) {
  const { cursor, limit = 20, ...rest } = opts;
  const params = new URLSearchParams({ limit, ...rest });
  if (cursor !== undefined) params.set("cursor", cursor);
  return cachedFetch(`/account/${wallet}/history/orders?${params.toString()}`);
}

// Canonical trading-pair config — the authoritative source for the exact
// `symbol` string and whether a pair is Crypto or Rwa (real-world-asset,
// e.g. a stock index). Useful for resolving a user-typed symbol (which may
// differ in casing/separators from the API's actual string, or may simply
// not appear in the live tickers feed) against the full known symbol list.
// opts: { category, assetClass } — both optional; omit assetClass to get
// every asset class back (Crypto + Rwa together).
function getAllSymbolConfig(opts = {}) {
  const params = new URLSearchParams(opts);
  const qs = params.toString();
  return cachedFetch(`/config/symbols${qs ? `?${qs}` : ""}`);
}

// Public referral-code lookup — resolves a referral code (e.g. "SATISH")
// to its owner's wallet address, plus rate/status info. This is the piece
// that lets a caller search by CODE instead of by wallet: look the code up
// here first to get `ownerAddress`, then pass that address into
// getReferralOverview() below. No auth required.
function getReferralCodeInfo(code, { fresh = false } = {}) {
  return cachedFetch(`/referral/codes/${code}`, { forceRefresh: fresh });
}

// Referral page init data for `walletId` — includes summary.depositedInvitees
// and summary.tradedInvitees, which PopDEX precomputes for you (no need to
// walk the invitee list and count firstDepositedAt/firstTradedAt yourself
// unless you need the per-invitee detail — see getReferralInvitees below).
function getReferralOverview(walletId, { fresh = false } = {}) {
  return cachedFetch(`/referral/${walletId}/overview`, { forceRefresh: fresh });
}

// Paginated invitee list for `walletId`'s referral network. Each invitee
// has firstDepositedAt / firstTradedAt (both null until that milestone is
// hit) if you need per-invitee detail rather than just the summary counts.
// opts: { referralCodeType, search, cursor, limit }
function getReferralInvitees(walletId, opts = {}) {
  const { cursor, limit = 20, ...rest } = opts;
  const params = new URLSearchParams({ limit, ...rest });
  if (cursor !== undefined) params.set("cursor", cursor);
  return cachedFetch(`/referral/${walletId}/invitees?${params.toString()}`);
}

module.exports = {
  getOverview,
  getPositions,
  getSettings,
  getEquityHistory,
  getClosedPositions,
  getPortfolioPerformance,
  getOpenInterest,
  getMarketTickers,
  getSingleTicker,
  getOrderHistory,
  getAllSymbolConfig,
  getReferralCodeInfo,
  getReferralOverview,
  getReferralInvitees
};
