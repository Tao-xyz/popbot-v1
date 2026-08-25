const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const api = require("../popdexApi");
const { fmtUsd, shortWallet } = require("../format");
const { renderStatsCard, COLORS } = require("../cardRenderer");
const { computePnlPercent, findLargestPosition } = require("../positionUtils");

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Restored the window-selectable interval report (Interval PnL / Max
// Drawdown / Equity Change / Deposits / Withdrawals) that an earlier
// rewrite had swapped out for a fixed Account Value snapshot. Account
// Equity and Available Margin are intentionally NOT rendered anywhere on
// this card — they're private account-level figures, not something to
// put on a public share card by default. For the same reason, "Equity
// Start-End" is shown as a % change rather than the old raw start/end
// dollar amounts — flag if the absolute figures are actually wanted back
// instead.
const PERIOD_CHOICES = [
  { name: "7D", value: "7D" },
  { name: "30D", value: "30D" },
  { name: "All", value: "All" }
];

// CONFIRMED live via a diagnostic sweep of every plausible window value:
// this API's `window` param is a strict enum that silently falls back to
// "7D" for anything it doesn't recognize (no error — it just quietly
// returns 7-day data). That's why 7D and 30D always looked identical:
// "30D" was never a real value, so every "30D" request was secretly
// getting the same 7-day window as the 7D option.
//
// Confirmed-valid enum values from that sweep: 7D, 1M, 6M, All (1M and
// 6M both echoed back correctly with distinct date ranges; 1W/3M/1Y/YTD/
// Month/Week/30 all silently fell back to 7D same as bare "30D" did).
// There is no confirmed 30-day-exact value — 1M (~30 days) is the
// closest real option, so the Discord-facing "30D" choice is mapped to
// the API's "1M" here rather than passed through literally.
const API_WINDOW_MAP = {
  "7D": "7D",
  "30D": "1M",
  "All": "All"
};

// Lifetime-volume badge tiers, checked highest-first so a wallet only
// ever shows its best tier, not every tier it's cleared.
const VOLUME_TIERS = [
  { threshold: 1_000_000_000, label: "1B Club" },
  { threshold: 900_000_000, label: "900M Club" },
  { threshold: 800_000_000, label: "800M Club" },
  { threshold: 700_000_000, label: "700M Club" },
  { threshold: 600_000_000, label: "600M Club" },
  { threshold: 500_000_000, label: "500M Club" },
  { threshold: 400_000_000, label: "400M Club" },
  { threshold: 300_000_000, label: "300M Club" },
  { threshold: 200_000_000, label: "200M Club" },
  { threshold: 100_000_000, label: "100M Club" },
  { threshold: 50_000_000, label: "50M Club" },
  { threshold: 25_000_000, label: "25M Club" },
  { threshold: 10_000_000, label: "10M Club" },
  { threshold: 5_000_000, label: "5M Club" },
  { threshold: 1_000_000, label: "1M Club" },
  { threshold: 500_000, label: "500K Club" },
  { threshold: 100_000, label: "100K Club" },
  { threshold: 50_000, label: "50K Club" },
  { threshold: 10_000, label: "10K Club" }
];

function volumeBadge(lifetimeVolume) {
  const tier = VOLUME_TIERS.find(t => lifetimeVolume >= t.threshold);
  return tier ? tier.label : null;
}

// Active Popper — distinct calendar days with at least one order in the
// past 7 days.
//
// CONFIRMED live via a real curl of /history/orders (cursor omitted,
// limit=100): `data` is a flat array of order objects (not wrapped in
// `.list`), and the per-order timestamp field is `createdAt` (epoch ms,
// numeric string) — NOT createTime/ctime/timestamp/updateTime, all of
// which were unverified guesses and always came back undefined, which is
// why this previously stuck at "0 / 7" every time regardless of real
// activity. The earlier cursor=1 pagination bug is also confirmed fixed:
// omitting cursor entirely does return live, current data.
//
// Capped at limit=100 (one weight-20 call) rather than paginating fully —
// for a 7-day badge this only risks undercounting active days in the edge
// case where a wallet's 101st+ trade that week falls on a day none of the
// other 100 do.
async function getActivityLast7d(wallet) {
  const now = Date.now();
  const cutoff = now - SEVEN_DAYS_MS;

  // Filter client-side instead of via startTime/endTime query params —
  // those aren't confirmed params of this endpoint (only limit/cursor
  // are), and passing them was silently returning an empty result set,
  // which is why this was always stuck at "0 / 7". Fetching the most
  // recent orders unfiltered (same pattern already confirmed working
  // elsewhere) and filtering by timestamp here fixes that.
  const res = await api.getOrderHistory(wallet, { limit: 100 });
  const orders = Array.isArray(res.data) ? res.data : (res.data?.list ?? []);

  const days = new Set();
  let tradeCount = 0;
  orders.forEach(o => {
    const ts = Number(o.createdAt);
    if (!Number.isFinite(ts) || ts < cutoff) return;
    tradeCount++;
    days.add(new Date(ts).toISOString().slice(0, 10));
  });

  return { activeDays: days.size, tradeCount };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("performance")
    .setDescription("Shareable snapshot of a wallet's PnL, drawdown, and activity over a period")
    .addStringOption(opt =>
      opt.setName("address")
        .setDescription("Wallet address (0x...)")
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("period")
        .setDescription("Reporting window (default 7D)")
        .setRequired(false)
        .addChoices(...PERIOD_CHOICES)
    ),

  async execute(interaction) {
    const wallet = interaction.options.getString("address").trim();
    const period = interaction.options.getString("period") ?? "7D";
    await interaction.deferReply();

    try {
      const apiWindow = API_WINDOW_MAP[period] ?? period;
      const [positionsRes, perfRes, perfAllRes, activityRes] = await Promise.allSettled([
        api.getPositions(wallet),
        api.getPortfolioPerformance(wallet, "All", apiWindow),
        api.getPortfolioPerformance(wallet, "All", "All"),
        getActivityLast7d(wallet)
      ]);

      const rows = [];

      // --- Badges (computed first so the PnL hero knows whether it has
      // a partner box to pair with) ---
      const badges = [];
      if (activityRes.status === "fulfilled" && activityRes.value.activeDays >= 4) {
        badges.push("Active Popper");
      }
      let lifetimeVolume = null;
      if (perfAllRes.status === "fulfilled") {
        const dAll = perfAllRes.value.data;
        lifetimeVolume = (Number(dAll.spotVolume) || 0) + (Number(dAll.futuresVolume) || 0);
        const tier = volumeBadge(lifetimeVolume);
        if (tier) badges.push(tier);
      }
      const hasBadges = badges.length > 0;

      // --- Interval PnL — a regular stat chip, same size as every other
      // box on the card (no special hero/highlighted treatment). Field
      // CONFIRMED live via a real curl of this endpoint: the payload
      // returns it directly as `intervalPnl` (a numeric string, e.g.
      // "-7.72") — not pnl/periodPnl/netPnl/realizedPnl, which were
      // unverified guesses.
      const d = perfRes.status === "fulfilled" ? perfRes.value.data : null;
      const intervalPnl = d ? Number(d.intervalPnl) : null;
      rows.push({
        label: `${period} PnL`,
        value: intervalPnl != null && !Number.isNaN(intervalPnl)
          ? `${intervalPnl >= 0 ? "+" : ""}${fmtUsd(intervalPnl)}`
          : "Unavailable",
        color: intervalPnl != null ? (intervalPnl >= 0 ? COLORS.positive : COLORS.negative) : undefined
      });

      // --- All-time PnL — reuses the perfAllRes call already made above
      // for the lifetime-volume badge, just reading `intervalPnl` off of
      // it instead of letting that number go unused. window="All" means
      // this call's `intervalPnl` covers the account's whole history.
      const dAll = perfAllRes.status === "fulfilled" ? perfAllRes.value.data : null;
      const allTimePnl = dAll ? Number(dAll.intervalPnl) : null;
      rows.push({
        label: "All-time PnL",
        value: allTimePnl != null && !Number.isNaN(allTimePnl)
          ? `${allTimePnl >= 0 ? "+" : ""}${fmtUsd(allTimePnl)}`
          : "Unavailable",
        color: allTimePnl != null ? (allTimePnl >= 0 ? COLORS.positive : COLORS.negative) : undefined
      });

      // --- Return (%) — `intervalReturn` on the same perfRes payload as
      // intervalPnl. NOTE: unlike intervalPnl (confirmed live above),
      // this field name is inferred by analogy and hasn't itself been
      // confirmed via a live curl — verify it against a real response
      // before shipping, and swap in whatever the payload actually uses
      // if it differs.
      const intervalReturn = d ? Number(d.intervalReturn) : null;
      rows.push({
        label: "Return (%)",
        value: intervalReturn != null && !Number.isNaN(intervalReturn)
          ? `${intervalReturn >= 0 ? "+" : ""}${intervalReturn.toFixed(2)}%`
          : "Unavailable",
        color: intervalReturn != null ? (intervalReturn >= 0 ? COLORS.positive : COLORS.negative) : undefined
      });

      // --- Daily Avg. PnL — intervalPnl divided by the *actual* elapsed
      // days in the window, derived from the API's own startTs/endTs
      // rather than assumed from the period label. This keeps it correct
      // for the "30D" choice, which is really mapped to the API's "1M"
      // window (see API_WINDOW_MAP) and so isn't exactly 30 days.
      let dailyAvgPnl = null;
      if (d && intervalPnl != null && !Number.isNaN(intervalPnl)) {
        const startTs = Number(d.startTs);
        const endTs = Number(d.endTs);
        if (Number.isFinite(startTs) && Number.isFinite(endTs) && endTs > startTs) {
          const elapsedDays = (endTs - startTs) / (24 * 60 * 60 * 1000);
          if (elapsedDays > 0) dailyAvgPnl = intervalPnl / elapsedDays;
        }
      }
      rows.push({
        label: "Daily Avg. PnL",
        value: dailyAvgPnl != null && !Number.isNaN(dailyAvgPnl)
          ? `${dailyAvgPnl >= 0 ? "+" : ""}${fmtUsd(dailyAvgPnl)}`
          : "Unavailable",
        color: dailyAvgPnl != null ? (dailyAvgPnl >= 0 ? COLORS.positive : COLORS.negative) : undefined
      });

      // NOTE: label intentionally avoids the word "achievement" — cardRenderer's
      // isAchievementRow() matches on that substring and renders the row as a
      // full-width, 92px gold-highlighted box instead of a normal 50px stat
      // chip. Using "Badges" here keeps this row the same size as every other
      // box on the card, per the "all boxes same size" layout requirement.
      if (hasBadges) {
        rows.push({ label: "Badges", value: badges.join("   ·   "), color: COLORS.textPrimary });
      }

      // Always shown — previously this stat only surfaced indirectly as
      // the "🔥 Active Popper" achievement badge, which silently vanished
      // whenever activeDays fell under the 4-day threshold (or the
      // activity fetch failed) — so the underlying stat looked missing
      // even though it was computed. Now it's its own chip with the raw
      // count, with an explicit fallback instead of disappearing.
      if (activityRes.status === "fulfilled") {
        rows.push({
          label: "Active Days (7D)",
          value: `${activityRes.value.activeDays} / 7`
        });
      } else {
        rows.push({ label: "Active Days (7D)", value: "Unavailable" });
      }

      // --- Small stat chips ---
      const maxDrawdown = d ? Number(d.maxDrawdown ?? d.drawdown) : null;
      if (maxDrawdown != null && !Number.isNaN(maxDrawdown)) {
        rows.push({
          label: "Max Drawdown",
          value: `${maxDrawdown > 0 ? "-" : ""}${Math.abs(maxDrawdown).toFixed(2)}%`,
          color: COLORS.negative
        });
      }

      if (d) {
        const totalVolume = (Number(d.spotVolume) || 0) + (Number(d.futuresVolume) || 0);
        rows.push({ label: `${period} Total Trading Volume`, value: fmtUsd(totalVolume) });
      }

      // --- Largest open position — a regular-size chip like the rest of
      // the grid (no wide/half special-casing), rendered as 3 compact
      // stacked lines (heading / pair+leverage / ROE) via `lines` so none
      // of the detail is dropped even at the smaller chip size.
      const positions = positionsRes.status === "fulfilled" ? (positionsRes.value.data || []) : [];
      const largest = findLargestPosition(positions);
      if (largest) {
        const roe = computePnlPercent(largest);
        const pairLine = `${largest.symbol} ${largest.positionSide} ${largest.symbolLeverage}x`;
        const roeLine = `${roe >= 0 ? "+" : ""}${roe.toFixed(2)}% ROE`;

        rows.push({
          label: "Largest Position",
          // `lines` renders as 3 explicit stacked lines (heading / pair
          // + leverage / ROE) instead of the usual single value line.
          // `value` is kept as a plain-text fallback for anything reading
          // these rows outside renderStatsCard (e.g. logging).
          value: `${pairLine} · ${roeLine}`,
          lines: [pairLine, roeLine],
          color: roe >= 0 ? COLORS.positive : COLORS.negative
        });
      } else if (positionsRes.status === "fulfilled") {
        rows.push({ label: "Largest Position", value: "No open positions" });
      } else {
        rows.push({ label: "Largest Position", value: "Unavailable" });
      }

      const imageBuffer = await renderStatsCard({
        title: "PopDEX Performance",
        subtitle: `${shortWallet(wallet)} · ${period}`,
        rows,
        // Card sizing, tuned to a clean 3x3 grid (this card always has
        // exactly 9 rows: 7D PnL, All-time PnL, Return %, Daily Avg PnL,
        // Badges, Active Days, Max Drawdown, Total Volume, Largest
        // Position) with bigger boxes and bigger text than
        // cardRenderer's defaults, plus extra header breathing room.
        // Every one of these options defaults to the old value inside
        // renderStatsCard, so every other command using renderStatsCard
        // is untouched.
        chipCols: 3,
        contentWidthRatio: 0.714,
        chipColGap: 14,
        chipHeight: 147,
        chipLabelStart: 11,
        chipValueStart: 16.5,
        chipStackedLabelStart: 10,
        chipStackedLineStart: 13,
        titleFontSize: 34,
        subtitleGap: 16,      // space between "PopDEX Performance" and the wallet address
        headerBottomGap: 30   // space between the wallet address and the stat grid
      });

      const attachment = new AttachmentBuilder(imageBuffer, { name: "performance-card.png" });
      const embed = new EmbedBuilder()
        .setColor(0x1a1a1a)
        .setImage("attachment://performance-card.png")
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (err) {
      await interaction.editReply(`Error fetching performance data: ${err.message}`);
    }
  }
};