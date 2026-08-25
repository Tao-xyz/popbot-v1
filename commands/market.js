const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const api = require("../popdexApi");
const { renderStatsCard } = require("../cardRenderer");

// Compact USD formatting for big aggregate numbers (volume, OI) — "$128.4M"
// reads faster and looks more polished on a card than a full number with
// commas. Available Pairs stays a plain integer since it's just a count.
function fmtCompactUsd(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

// Normalizes a symbol for comparison — strips anything that isn't a
// letter/digit and uppercases. Handles the exchange UI possibly showing
// "TECH100-USDT" while the API's actual `symbol` field is "TECH100USDT"
// (or the reverse, or an underscore) without caring which side has the
// separator.
function normalizeSymbol(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function tickerFromRaw(t) {
  const lastPrice = parseFloat(t.lastPrice);
  return {
    symbol: t.symbol,
    turnover24h: parseFloat(t.turnover24h),
    price24hPcnt: parseFloat(t.price24hPcnt),
    openInterestUsd: parseFloat(t.openInterest || 0) * lastPrice
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("market")
    .setDescription("View 24h volume and open interest across PopDEX futures pairs")
    .addStringOption(opt =>
      opt.setName("symbol")
        .setDescription("Trading pair, e.g. BTCUSDT (leave empty for all pairs)")
    ),

  async execute(interaction) {
    const symbol = interaction.options.getString("symbol")?.trim().toUpperCase();
    await interaction.deferReply();

    try {
      // Two independent data sources, fetched together:
      //  - allSymbols (Get All Symbol Config): the AUTHORITATIVE, complete
      //    list of every configured Futures pair (Crypto + Rwa), no
      //    pagination in its response shape. This is the correct source
      //    for "how many pairs exist" and "does this pair exist at all" —
      //    it's also always current, since new pairs PopDEX adds show up
      //    here automatically with zero code changes needed.
      //  - tickers (Get Tickers, Crypto + Rwa asset classes merged): live
      //    24h volume / OI / price. This feed is NOT guaranteed complete —
      //    confirmed some configured pairs don't show up in it — so it's
      //    only trusted for pairs it actually returns, never for the total
      //    pair count.
      //
      // NOTE: the Crypto/Rwa split here stays as-is — it's independently
      // confirmed (see getMarketTickers in popdexApi.js) that Rwa pairs
      // don't appear at all under a plain `category=Futures` call without
      // an explicit assetClass. That's a separate, real gap from the one
      // below: TRUMPUSDT (assetClass "Crypto") and TECH100USDT (assetClass
      // "Rwa") are BOTH still missing after this split-and-merge, which
      // rules out assetClass as the cause of THAT gap specifically. So the
      // split fetch is kept (it's still doing real work for Rwa pairs
      // generally), and a second, independent backfill pass below handles
      // whatever individual pairs still fall through either way.
      const [configRes, cryptoRes, rwaRes] = await Promise.allSettled([
        api.getAllSymbolConfig({ category: "Futures" }),
        api.getMarketTickers("Futures", "Crypto"),
        api.getMarketTickers("Futures", "Rwa")
      ]);

      if (configRes.status === "rejected") throw configRes.reason;
      const allSymbols = configRes.value.data || [];

      const rawTickers = [];
      if (cryptoRes.status === "fulfilled") rawTickers.push(...(cryptoRes.value.data || []));
      if (rwaRes.status === "fulfilled") rawTickers.push(...(rwaRes.value.data || []));

      // Dedupe by symbol in case both calls ever overlap (e.g. if the API
      // ignores an unrecognized assetClass value and returns everything
      // both times).
      const seenSymbols = new Set();
      let tickers = rawTickers
        .filter(t => {
          if (seenSymbols.has(t.symbol)) return false;
          seenSymbols.add(t.symbol);
          return true;
        })
        // openInterest comes back in base-asset units (e.g. BTC amount for
        // BTCUSDT) — convert to USD notional so it's comparable/summable
        // across different pairs.
        .map(tickerFromRaw);

      // Backfill pass: any config-confirmed pair still absent from the
      // merged bulk tickers gets a direct single-symbol lookup. This is
      // deliberately unconditional (runs whether or not the user asked
      // for one symbol), so a `/market symbol:TRUMPUSDT` request benefits
      // from it too, not just the "all pairs" view.
      //
      // Capped at 15 backfill calls per invocation as a safety margin —
      // in normal operation this should only ever be a handful of pairs;
      // if it's ever more than that, something upstream is broken enough
      // that spamming 20+ individual requests per command isn't the fix.
      const BACKFILL_CAP = 15;
      const initiallyMissing = allSymbols.filter(
        s => !tickers.some(t => normalizeSymbol(t.symbol) === normalizeSymbol(s.symbol))
      );

      if (initiallyMissing.length > 0) {
        const toBackfill = initiallyMissing.slice(0, BACKFILL_CAP);
        const backfillResults = await Promise.allSettled(
          toBackfill.map(s => api.getSingleTicker(s.symbol))
        );

        backfillResults.forEach(r => {
          if (r.status !== "fulfilled") return;
          // Tolerate either an array (matches bulk shape) or a single
          // object, since the single-symbol response shape isn't
          // independently confirmed yet.
          const data = r.value.data;
          const entry = Array.isArray(data) ? data[0] : data;
          if (entry && entry.symbol) {
            tickers.push(tickerFromRaw(entry));
          }
        });
      }

      // Recomputed AFTER backfill — this is what's actually still missing
      // once the targeted lookups have had a chance to fill gaps.
      const missingSymbols = allSymbols.filter(
        s => !tickers.some(t => normalizeSymbol(t.symbol) === normalizeSymbol(s.symbol))
      );

      let noMatchReason = null; // 'typo' | 'no_ticker' | null
      let closeMatches = [];

      if (symbol) {
        const target = normalizeSymbol(symbol);
        const exact = tickers.filter(t => normalizeSymbol(t.symbol) === target);

        if (exact.length > 0) {
          tickers = exact;
        } else {
          tickers = [];
          const configMatch = allSymbols.find(s => normalizeSymbol(s.symbol) === target);

          if (configMatch) {
            noMatchReason = "no_ticker";
          } else {
            noMatchReason = "typo";
            closeMatches = allSymbols
              .filter(s => normalizeSymbol(s.symbol).includes(target) || target.includes(normalizeSymbol(s.symbol)))
              .slice(0, 5);
          }
        }
      }

      if (tickers.length === 0) {
        let noDataRows;
        let replyContent;

        if (noMatchReason === "no_ticker") {
          noDataRows = [{ label: "Data", value: "No live ticker for this pair" }];
          replyContent = `**${symbol}** is a configured pair (confirmed via the symbol config), but neither the bulk tickers feed nor a direct single-symbol lookup is returning live data for it right now. This is a gap on the data-source side, not a typo — the pair count and totals elsewhere account for this.`;
        } else if (closeMatches.length > 0) {
          noDataRows = [
            { label: "Data", value: "No exact match" },
            { label: "Did you mean", value: closeMatches.map(s => s.symbol).join(", "), wide: true }
          ];
        } else {
          noDataRows = [{ label: "Data", value: "No pairs found" }];
        }

        const imageBuffer = await renderStatsCard({
          title: "PopDEX Market",
          subtitle: symbol || "All Pairs",
          rows: noDataRows
        });
        const attachment = new AttachmentBuilder(imageBuffer, { name: "market-card.png" });
        await interaction.editReply({
          content: replyContent,
          embeds: [new EmbedBuilder().setColor(0x1a1a1a).setImage("attachment://market-card.png")],
          files: [attachment]
        });
        return;
      }

      tickers.sort((a, b) => b.turnover24h - a.turnover24h);

      const totalVolume = tickers.reduce((acc, t) => acc + t.turnover24h, 0);
      const totalOI = tickers.reduce((acc, t) => acc + t.openInterestUsd, 0);

      // "Available Pairs" always reflects the true configured count from
      // symbol config — NOT tickers.length — so this number is correct
      // even when the tickers feed is missing some pairs. When filtering
      // to one symbol, tickers.length is already exactly 1 there, so this
      // distinction only matters for the "all pairs" view.
      const availablePairsCount = symbol ? tickers.length : allSymbols.length;

      const rows = [
        { label: "Total 24h Volume", value: fmtCompactUsd(totalVolume), hero: true },
        { label: "Total Open Interest", value: fmtCompactUsd(totalOI) },
        { label: "Available Pairs", value: String(availablePairsCount) }
      ];

      // Be upfront when the volume/OI totals above don't cover every
      // configured pair, instead of quietly presenting a partial sum as
      // if it were complete. After the backfill pass, this should now
      // only fire for pairs that are genuinely unavailable everywhere
      // (or, rarely, past the BACKFILL_CAP).
      let replyContent;
      if (!symbol && missingSymbols.length > 0) {
        const names = missingSymbols.slice(0, 6).map(s => s.symbol).join(", ");
        const more = missingSymbols.length > 6 ? ` +${missingSymbols.length - 6} more` : "";
        replyContent = `Note: totals above exclude ${missingSymbols.length} pair(s) with no live ticker data anywhere (bulk or single-symbol lookup): ${names}${more}.`;
      }

      const imageBuffer = await renderStatsCard({
        title: "PopDEX Market",
        subtitle: symbol || "All Pairs",
        rows,
        // Bigger hero number for Total 24h Volume — default is 46/24
        // (start/floor); this bumps it up so it reads as a bolder
        // headline stat.
        heroValueStart: 60,
        heroValueMin: 32
      });

      const attachment = new AttachmentBuilder(imageBuffer, { name: "market-card.png" });
      const embed = new EmbedBuilder()
        .setColor(0x1a1a1a)
        .setImage("attachment://market-card.png")
        .setTimestamp();

      await interaction.editReply({ content: replyContent, embeds: [embed], files: [attachment] });
    } catch (err) {
      await interaction.editReply(`Error fetching market data: ${err.message}`);
    }
  }
};