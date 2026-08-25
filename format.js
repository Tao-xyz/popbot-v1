function fmtUsd(v) {
  const n = Number(v);
  if (isNaN(n)) return "—";
  return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtNum(v, d = 4) {
  const n = Number(v);
  if (isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}

function fmtPct(decimalStr) {
  const n = Number(decimalStr);
  if (isNaN(n)) return "—";
  return (n * 100).toFixed(2) + "%";
}

function shortWallet(w) {
  if (!w || w.length < 10) return w;
  return `${w.slice(0, 6)}...${w.slice(-4)}`;
}

module.exports = { fmtUsd, fmtNum, fmtPct, shortWallet };
