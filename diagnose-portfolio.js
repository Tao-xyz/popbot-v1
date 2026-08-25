// Standalone diagnostic — NOT part of the bot, just a one-off script to
// figure out why /account/{wallet}/portfolio returns the same numbers
// regardless of the requested window.
//
// It hits the endpoint with several plausible param name/value variants
// side by side, so a single run tells us which one (if any) actually
// changes the result.
//
// USAGE:
//   node diagnose-portfolio.js 0xYOUR_WALLET_ADDRESS
//
// Then paste the FULL console output back into the chat.

const API_BASE = process.env.POPDEX_API_BASE || "https://api.popdex.xyz/api/v1";

const wallet = process.argv[2];
if (!wallet) {
  console.error("Usage: node diagnose-portfolio.js 0xYOUR_WALLET_ADDRESS");
  process.exit(1);
}

// Every variant we want to try. Each is a full query string appended to
// /account/{wallet}/portfolio — trying different param NAMES and
// different VALUE FORMATS in case the API is picky about casing/shape.
const variants = [
  { label: "window=7D (current bot code)", qs: "scope=All&window=7D" },
  { label: "window=30D (current bot code)", qs: "scope=All&window=30D" },
  { label: "window=All (current bot code)", qs: "scope=All&window=All" },
  { label: "window=7d (lowercase)", qs: "scope=All&window=7d" },
  { label: "window=30d (lowercase)", qs: "scope=All&window=30d" },
  { label: "period=7D", qs: "scope=All&period=7D" },
  { label: "period=30D", qs: "scope=All&period=30D" },
  { label: "range=7D", qs: "scope=All&range=7D" },
  { label: "range=30D", qs: "scope=All&range=30D" },
  { label: "days=7", qs: "scope=All&days=7" },
  { label: "days=30", qs: "scope=All&days=30" },
  { label: "interval=7D", qs: "scope=All&interval=7D" },
  { label: "interval=30D", qs: "scope=All&interval=30D" },
  { label: "no window param at all", qs: "scope=All" }
];

async function run() {
  console.log(`\nDiagnosing GET /account/${wallet}/portfolio for ${variants.length} variants...\n`);

  for (const v of variants) {
    const url = `${API_BASE}/account/${wallet}/portfolio?${v.qs}`;
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
      const json = await res.json();
      const d = json.data;

      // Print just the fields we care about, compactly, so it's easy to
      // eyeball differences across variants instead of scrolling through
      // full JSON dumps each time.
      console.log(`--- ${v.label} ---`);
      console.log(`  URL: ${url}`);
      console.log(`  HTTP ${res.status} | code: ${json.code} | msg: ${json.msg ?? ""}`);
      if (d) {
        console.log(`  intervalPnl: ${d.intervalPnl}`);
        console.log(`  spotVolume: ${d.spotVolume}  futuresVolume: ${d.futuresVolume}`);
        console.log(`  maxDrawdown/drawdown: ${d.maxDrawdown ?? d.drawdown}`);
        // Dump any other top-level keys so we can spot an echoed window/
        // period/date-range field we haven't thought to check yet.
        console.log(`  other keys: ${Object.keys(d).join(", ")}`);
      } else {
        console.log(`  data: ${JSON.stringify(json.data)}`);
      }
      console.log("");
    } catch (err) {
      console.log(`--- ${v.label} ---`);
      console.log(`  ERROR: ${err.message}\n`);
    }

    // Small delay to be polite to the shared rate limit.
    await new Promise(r => setTimeout(r, 300));
  }

  console.log("Done. Paste this entire output back into the chat.");
}

run();
