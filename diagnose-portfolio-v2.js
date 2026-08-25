// Standalone diagnostic v2 — narrows down exactly what "window" values
// the /account/{wallet}/portfolio endpoint actually honors.
//
// v1 showed window=All is clearly recognized (very different numbers),
// but 7D/30D/range/days/interval all collapsed to nearly the same
// result — meaning most values are silently being ignored. This version
// decodes eqStartTs/eqEndTs (which the API returns) into real dates, so
// we can see the ACTUAL date range each request produced, even if the
// PnL number itself looks similar. It also tries a few more common
// enum-style values (1W/1M/3M/6M/1Y/YTD) in case "30D" just isn't the
// string this API expects.
//
// USAGE:
//   node diagnose-portfolio-v2.js 0xYOUR_WALLET_ADDRESS
//
// Then paste the FULL console output back into the chat.

const API_BASE = process.env.POPDEX_API_BASE || "https://api.popdex.xyz/api/v1";

const wallet = process.argv[2];
if (!wallet) {
  console.error("Usage: node diagnose-portfolio-v2.js 0xYOUR_WALLET_ADDRESS");
  process.exit(1);
}

const variants = [
  { label: "window=7D",  qs: "scope=All&window=7D" },
  { label: "window=30D", qs: "scope=All&window=30D" },
  { label: "window=All", qs: "scope=All&window=All" },
  { label: "window=1W",  qs: "scope=All&window=1W" },
  { label: "window=1M",  qs: "scope=All&window=1M" },
  { label: "window=3M",  qs: "scope=All&window=3M" },
  { label: "window=6M",  qs: "scope=All&window=6M" },
  { label: "window=1Y",  qs: "scope=All&window=1Y" },
  { label: "window=YTD", qs: "scope=All&window=YTD" },
  { label: "window=Month", qs: "scope=All&window=Month" },
  { label: "window=Week", qs: "scope=All&window=Week" },
  { label: "window=30",  qs: "scope=All&window=30" }
];

// Turns an epoch-ms-or-seconds-looking value into a readable date, or
// returns the raw value if it doesn't look like a timestamp at all.
function toDate(v) {
  if (v === undefined || v === null) return String(v);
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  // Heuristic: ms epoch is ~13 digits right now, s epoch is ~10 digits.
  const ms = String(Math.trunc(n)).length >= 13 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

async function run() {
  console.log(`\nDiagnosing GET /account/${wallet}/portfolio — decoding actual date ranges for ${variants.length} variants...\n`);

  for (const v of variants) {
    const url = `${API_BASE}/account/${wallet}/portfolio?${v.qs}`;
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
      const json = await res.json();
      const d = json.data;

      console.log(`--- ${v.label} ---`);
      console.log(`  HTTP ${res.status} | code: ${json.code} | msg: ${json.msg ?? ""}`);
      if (d) {
        console.log(`  intervalPnl: ${d.intervalPnl}  intervalReturn: ${d.intervalReturn}`);
        console.log(`  futuresVolume: ${d.futuresVolume}  spotVolume: ${d.spotVolume}`);
        console.log(`  window (as echoed by API): ${d.window}`);
        console.log(`  startTs -> ${toDate(d.startTs)}`);
        console.log(`  endTs   -> ${toDate(d.endTs)}`);
        console.log(`  eqStartTs -> ${toDate(d.eqStartTs)}`);
        console.log(`  eqEndTs   -> ${toDate(d.eqEndTs)}`);
        console.log(`  eqStart: ${d.eqStart}  eqEnd: ${d.eqEnd}  principal: ${d.principal}`);
      } else {
        console.log(`  data: ${JSON.stringify(json.data)}`);
      }
      console.log("");
    } catch (err) {
      console.log(`--- ${v.label} ---`);
      console.log(`  ERROR: ${err.message}\n`);
    }

    await new Promise(r => setTimeout(r, 300));
  }

  console.log("Done. Paste this entire output back into the chat.");
}

run();
