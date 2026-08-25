'use strict';

function num(value, { decimals = 2 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function compact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
}

function usd(value, { compact: useCompact = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (useCompact) return `$${compact(n)}`;
  return `$${num(n)}`;
}

function pct(value, { decimals = 2, signed = true } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const pctVal = n * 100;
  const sign = signed && pctVal > 0 ? '+' : '';
  return `${sign}${pctVal.toFixed(decimals)}%`;
}

// Some Popdex fields (price24hPcnt) are already fractional decimals (0.0183 = 1.83%)
function pctFromFraction(value, opts) {
  return pct(value, opts);
}

function price(value, { decimals } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  let dp = decimals;
  if (dp === undefined) {
    dp = n >= 1000 ? 2 : n >= 1 ? 4 : 6;
  }
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function timeAgo(tsMs) {
  const n = Number(tsMs);
  if (!Number.isFinite(n)) return '—';
  const diffSec = Math.max(0, Math.floor((Date.now() - n) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr || '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

module.exports = { num, compact, usd, pct, pctFromFraction, price, timeAgo, shortAddr };
