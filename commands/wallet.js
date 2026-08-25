const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const api = require("../popdexApi");
const { fmtUsd, shortWallet } = require("../format");
const { renderStatsCard, COLORS } = require("../cardRenderer");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("wallet")
    .setDescription("Look up a PopDEX wallet's balance, positions, and volume")
    .addStringOption(opt =>
      opt.setName("address")
        .setDescription("Wallet address (0x...)")
        .setRequired(true)
    ),

  async execute(interaction) {
    const wallet = interaction.options.getString("address").trim();
    await interaction.deferReply();

    try {
      // NOTE: accountEquity / availableMargin (from api.getOverview) are
      // intentionally NOT fetched/rendered on this public share card —
      // those are private account-level figures and shouldn't be exposed
      // by default.
      const [positionsRes, historyRes] = await Promise.allSettled([
        api.getPositions(wallet),
        api.getEquityHistory(wallet)
      ]);

      const rows = [];

      if (historyRes.status === "fulfilled") {
        const periods = historyRes.value.data || [];
        const day = periods.find(p => p.period === "Day");
        if (day) {
          const totalVolume = (Number(day.spotVolume) || 0) + (Number(day.futuresVolume) || 0);
          // Hero treatment: one big full-width featured box up top, same
          // "hero" styling cardRenderer already uses for Referral Code /
          // Total 24H Volume elsewhere — big centered number instead of a
          // small stat chip. Open Positions grid renders below it as its
          // own section (unchanged).
          rows.push({ label: "24h Total Trading Volume", value: fmtUsd(totalVolume), hero: true });
        }
      }

      if (positionsRes.status === "fulfilled") {
        const positions = positionsRes.value.data || [];
        rows.push({ label: "Open Positions", value: String(positions.length) });

        // NOTE: field names (entryPrice / markPrice / liqPrice) follow the
        // same camelCase convention as the rest of the positions payload
        // (unPnl, symbolLeverage) — verify against the real API response
        // and adjust here if any of these are named differently.
        // Show up to 8 open positions. 4 or fewer: one full-width row each
        // (roomier). More than 4: switch to two-per-row so 8 positions
        // don't stretch the card into a huge vertical strip — still inside
        // the left stats column, not eating into the background art on
        // the right.
        const shownPositions = positions.slice(0, 8);
        const useHalfRows = shownPositions.length > 4;

        shownPositions.forEach(p => {
          const pnl = Number(p.unPnl);
          const sign = pnl >= 0 ? "+" : "";
          const pnlColor = pnl >= 0 ? COLORS.positive : COLORS.negative;

          // Trying a few common alternate field names until the real ones
          // are confirmed — "N/A" shows instead of a blank/"$NaN" if none
          // of these match your actual API response.
          const markPrice = p.markPrice ?? p.currentPrice ?? p.lastPrice;
          const fmtOrNA = v => (v === undefined || v === null || Number.isNaN(Number(v))) ? "N/A" : fmtUsd(v);

          rows.push({
            label: `${p.symbol} ${p.positionSide} ${p.symbolLeverage}x`,
            value: `Mark ${fmtOrNA(markPrice)}  |  PnL ${sign}${fmtUsd(p.unPnl)}`,
            color: pnlColor,
            wide: !useHalfRows,
            half: useHalfRows
          });
        });
      } else {
        rows.push({ label: "Open Positions", value: "Unavailable" });
      }

      const imageBuffer = await renderStatsCard({
        title: `PopDEX Wallet`,
        subtitle: shortWallet(wallet),
        rows
      });

      const attachment = new AttachmentBuilder(imageBuffer, { name: "wallet-card.png" });
      const embed = new EmbedBuilder()
        .setColor(0x1a1a1a)
        .setImage("attachment://wallet-card.png")
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (err) {
      await interaction.editReply(`Error fetching wallet data: ${err.message}`);
    }
  }
};