const { fmtUsd } = require("./format");

// "BTCUSDT" -> "BTC". Falls back to the raw symbol if it doesn't end in USDT.
function shortSymbol(symbol) {
  return symbol?.toUpperCase().endsWith("USDT") ? symbol.toUpperCase().slice(0, -4) : symbol;
}

// Confirmed live via GET /account/{wallet}/positions AND cross-checked
// against the real PopDEX UI's "Unrealized PnL (ROE)" column:
//   Entry 64,129 / Mark 64,172 / 5x / Short  ->  UI shows -0.33%
//   (64,172 - 64,129) / 64,129 * 5 = 0.335%, negated for Short = -0.33% ✓
// So ROE% here is a pure price-move calc (avgOpenPrice/markPrice/leverage/
// side) — NOT unPnl/initialMargin, which gives the wrong number. Kept only
// as a last-resort fallback for the rare case avgOpenPrice/markPrice is
// missing.
function computePnlPercent(p) {
  const entryPrice = parseFloat(p.avgOpenPrice ?? p.entryPrice ?? p.avgEntryPrice);
  const markPrice = parseFloat(p.markPrice ?? p.currentPrice ?? p.lastPrice);
  const leverage = Number(p.symbolLeverage ?? p.leverage);
  const side = (p.positionSide || p.side || "").toUpperCase();

  if (Number.isFinite(entryPrice) && entryPrice !== 0 && Number.isFinite(markPrice) && Number.isFinite(leverage) && leverage !== 0) {
    const rawMove = (markPrice - entryPrice) / entryPrice;
    return (side === "SHORT" ? -rawMove : rawMove) * leverage * 100;
  }

  const unPnl = Number(p.unPnl);
  const initialMargin = Number(p.initialMargin);
  if (Number.isFinite(unPnl) && Number.isFinite(initialMargin) && initialMargin !== 0) {
    return (unPnl / initialMargin) * 100;
  }

  return 0;
}

function getMarkPrice(p) {
  const markPrice = p.markPrice ?? p.currentPrice ?? p.lastPrice;
  return (markPrice === undefined || markPrice === null || Number.isNaN(Number(markPrice)))
    ? "N/A"
    : fmtUsd(markPrice);
}

// Notional volume (position "size" in dollar terms) = margin posted ×
// leverage. There's no confirmed direct quantity/notional field from the
// API yet, so this is derived from two fields that ARE already confirmed
// elsewhere in this file (initialMargin, symbolLeverage) rather than a
// guessed field name like positionAmt/notionalValue/positionValue.
// UNVERIFIED against a live payload until cross-checked against the real
// PopDEX UI's own volume figure, same as computePnlPercent was before it
// got confirmed above — flag if it drifts from the UI once checked.
function getNotionalVolume(p) {
  const margin = Number(p.initialMargin);
  const leverage = Number(p.symbolLeverage ?? p.leverage);
  if (Number.isFinite(margin) && Number.isFinite(leverage)) {
    return margin * leverage;
  }
  return Number.isFinite(margin) ? margin : 0;
}

// Largest open position BY VOLUME (notional exposure = margin ×
// leverage) — NOT by margin posted alone. A 2x $500 position and a 10x
// $500 position post the same margin, but the second carries 5x the
// market exposure, so ranking by margin alone under-ranks the leveraged
// one. Previously sorted by initialMargin only; switched to
// getNotionalVolume so "largest position" actually means largest
// position size, not largest margin posted.
function findLargestPosition(positions) {
  if (!positions || positions.length === 0) return null;
  return [...positions].sort(
    (a, b) => getNotionalVolume(b) - getNotionalVolume(a)
  )[0];
}

module.exports = {
  shortSymbol,
  computePnlPercent,
  getMarkPrice,
  getNotionalVolume,
  findLargestPosition
};