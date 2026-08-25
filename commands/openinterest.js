const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const api = require("../popdexApi");
const { renderStatsCard } = require("../cardRenderer");

// Full comma-grouped number — NOT abbreviated (no K/M/B suffix). Standard
// thousand-separator grouping at every 3 digits: hundreds stay plain
// ("999.50"), thousands get one comma ("128,400.50"), millions get two
// ("1,234,567.89"), billions get three ("1,234,567,890.00") — always with
// exactly `decimals` digits after the point. Replaces the old fmtNum
// import from ../format, which was abbreviating to K/M with 2 digits
// (e.g. "128.40K") instead of showing the full number.
function fmtComma(value, decimals = 2) {
  const n = Number(value) || 0;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("oi")
    .setDescription("View open interest for a trading pair, or all pairs")
    .addStringOption(opt =>
      opt.setName("symbol")
        .setDescription("Trading pair, e.g. BTCUSDT (leave empty for all pairs)")
    ),

  async execute(interaction) {
    const symbol = interaction.options.getString("symbol");
    await interaction.deferReply();

    try {
      const res = await api.getOpenInterest(symbol);
      const rowsData = res.data || [];

      const rows = rowsData.length === 0
        ? [{ label: "Open Interest", value: "No data found" }]
        : rowsData.slice(0, 12).map(r => ({ label: r.symbol, value: fmtComma(r.openInterest, 2) }));

      const imageBuffer = await renderStatsCard({
        title: "PopDEX Open Interest",
        subtitle: symbol ? symbol : "All Pairs",
        rows,
        // Shifted leftward: widens the stat grid from the default 68%
        // of card width to 78%, so the chip boxes sit further left as a
        // group, with less empty space on the right.
        contentWidthRatio: 0.68,
        // Enlarges the whole poster (canvas, text, boxes, everything)
        // by 30% — not just the content area.
        scale: 1.3,
        // Forces 2 columns instead of the default 3 for this many chips
        // — each box then claims 3/2 = 1.5x the width, since cellW =
        // contentW / cols. With 12 pairs that's 6 rows of 2 (was 4 rows
        // of 3 at the default column count) — card height auto-expands
        // to fit the extra rows.
        chipCols: 2
      });

      const attachment = new AttachmentBuilder(imageBuffer, { name: "oi-card.png" });
      const embed = new EmbedBuilder()
        .setColor(0x1a1a1a)
        .setImage("attachment://oi-card.png")
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (err) {
      await interaction.editReply(`Error fetching open interest: ${err.message}`);
    }
  }
};