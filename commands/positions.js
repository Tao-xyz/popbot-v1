const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");
const api = require("../popdexApi");
const { fmtUsd, shortWallet } = require("../format");
const { renderStatsCard, renderPositionCard } = require("../cardRenderer");

// Discord hard-caps at 5 buttons per row and 5 rows per message (25 total).
// Use the real ceiling — trimming below it (this used to cap at 20) silently
// drops real positions from the picker once a wallet has more than that.
const MAX_BUTTONS = 25;
const BUTTONS_PER_ROW = 5;
const COLLECTOR_MS = 60_000;

// "BTCUSDT" -> "BTC". Falls back to the raw symbol if it doesn't end in USDT.
function shortSymbol(symbol) {
  return symbol?.toUpperCase().endsWith("USDT") ? symbol.toUpperCase().slice(0, -4) : symbol;
}

// NOTE: field names (entryPrice / markPrice / positionSide / symbolLeverage)
// follow the same convention used in wallet.js — verify against the real
// getPositions() response and adjust here if any of these differ.
//
// DEBUG: uncomment the line below, run /positions once, then check your
// bot's console — it'll print the exact field names/values your API
// actually returns so we can match computePnlPercent() to them exactly.
// console.log("[positions debug] raw position object:", JSON.stringify(p, null, 2));
// Confirmed live via GET /account/{wallet}/positions — real field names are:
//   avgOpenPrice, markPrice, unPnl, initialMargin, symbolLeverage,
//   positionSide ("Long"/"Short"), symbol. There's no ready-made ROI%
// field, but the exchange's own accounting gives us unPnl (dollar PnL)
// and initialMargin (margin actually posted) — so ROI% = unPnl/initialMargin
// * 100 is exactly how the platform itself would compute it. That's the
// primary path now; the old price-move formula is kept only as a fallback
// in case initialMargin is ever missing/zero on some position type.
// Confirmed live via GET /account/{wallet}/positions AND cross-checked
// against the real PopDEX UI's "Unrealized PnL (ROE)" column:
//   Entry 64,129 / Mark 64,172 / 5x / Short  ->  UI shows -0.33%
//   (64,172 - 64,129) / 64,129 * 5 = 0.335%, negated for Short = -0.33% ✓
// So ROE% here is a pure price-move calc (avgOpenPrice/markPrice/leverage/
// side) — NOT unPnl/initialMargin, which gives the wrong number (that
// combination worked out to -0.52% on the same position, which doesn't
// match the UI). Keeping unPnl/initialMargin only as a last-resort
// fallback for the rare case avgOpenPrice or markPrice is missing.
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

function buildButtons(positions) {
  const shown = positions.slice(0, MAX_BUTTONS);

  // Disambiguate duplicate labels (e.g. hedge-mode LONG + SHORT on the same pair).
  const seen = new Map();
  shown.forEach(p => {
    const base = shortSymbol(p.symbol);
    seen.set(base, (seen.get(base) || 0) + 1);
  });

  const rows = [];
  for (let i = 0; i < shown.length; i += BUTTONS_PER_ROW) {
    const row = new ActionRowBuilder();
    shown.slice(i, i + BUTTONS_PER_ROW).forEach((p, j) => {
      const idx = i + j;
      const base = shortSymbol(p.symbol);
      const label = seen.get(base) > 1 && p.positionSide ? `${base} ${p.positionSide.toUpperCase()}` : base;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`pos_${idx}`)
          .setLabel(label)
          .setStyle(ButtonStyle.Secondary)
      );
    });
    rows.push(row);
  }
  return rows;
}

async function buildPositionCardAttachment(p, referralCode) {
  const imageBuffer = await renderPositionCard({
    symbol: p.symbol,
    side: p.positionSide ? p.positionSide.toUpperCase() : undefined,
    leverage: p.symbolLeverage,
    pnlPercent: computePnlPercent(p),
    markPrice: getMarkPrice(p),
    referralCode
  });
  return new AttachmentBuilder(imageBuffer, { name: "position-card.png" });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("positions")
    .setDescription("Pick one of a wallet's open PopDEX positions and view its PNL poster")
    .addStringOption(opt =>
      opt.setName("address")
        .setDescription("Wallet address (0x...)")
        .setRequired(true)
    ),

  async execute(interaction) {
    const wallet = interaction.options.getString("address").trim();
    await interaction.deferReply();

    try {
      const [positionsRes, referralRes] = await Promise.allSettled([
        api.getPositions(wallet),
        api.getReferralOverview(wallet)
      ]);

      if (positionsRes.status === "rejected") throw positionsRes.reason;
      const positions = positionsRes.value.data || [];

      // Non-fatal — if the referral lookup fails, the position cards
      // still render fine, just without the promo pill.
      const referralCode = referralRes.status === "fulfilled"
        ? (referralRes.value.data?.referralCode?.referralCode ?? null)
        : null;

      // Sort by position size (initialMargin — confirmed field, see the
      // notes on computePnlPercent above) so that if a wallet ever has
      // more than MAX_BUTTONS positions, the picker shows the biggest
      // ones, not whatever order the API happened to return.
      positions.sort((a, b) => (Number(b.initialMargin) || 0) - (Number(a.initialMargin) || 0));

      if (positions.length === 0) {
        const imageBuffer = await renderStatsCard({
          title: "PopDEX Positions",
          subtitle: shortWallet(wallet),
          rows: [{ label: "Open Positions", value: "None found", align: "center" }],
          // This row is alone on the card (single wide chip), so there's
          // plenty of box width for a bigger value — bumped from the
          // default 13px start to 26px so "None found" doesn't read as
          // an afterthought. Only affects this empty-state card; every
          // other renderStatsCard call elsewhere keeps the default size.
          chipValueStart: 26,
          // Content occupies 80% of the card width, leaving exactly 20%
          // clear on the right (default is ~32% clear).
          contentWidthRatio: 0.68
        });
        const attachment = new AttachmentBuilder(imageBuffer, { name: "positions-card.png" });
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0x1a1a1a).setImage("attachment://positions-card.png")],
          files: [attachment]
        });
        return;
      }

      const rows = buildButtons(positions);
      const truncated = positions.length > MAX_BUTTONS;
      const countLine = `${shortWallet(wallet)} has ${positions.length} open position${positions.length === 1 ? "" : "s"}.`;
      const pickLine = truncated
        ? ` Showing the first ${MAX_BUTTONS} (Discord's button limit) — pick one to view its PNL poster:`
        : " Pick one to view its PNL poster:";

      const reply = await interaction.editReply({
        content: countLine + pickLine,
        components: rows
      });

      const collector = reply.createMessageComponentCollector({ time: COLLECTOR_MS });

      collector.on("collect", async btnInt => {
        if (btnInt.user.id !== interaction.user.id) {
          await btnInt.reply({ content: "This picker isn't for you — run `/positions` yourself.", ephemeral: true });
          return;
        }

        const idx = Number(btnInt.customId.replace("pos_", ""));
        const position = positions[idx];
        if (!position) {
          await btnInt.reply({ content: "That position isn't available anymore.", ephemeral: true });
          return;
        }

        await btnInt.deferUpdate();

        try {
          const attachment = await buildPositionCardAttachment(position, referralCode);
          const embed = new EmbedBuilder()
            .setColor(0x1a1a1a)
            .setImage("attachment://position-card.png")
            .setTimestamp();

          await interaction.editReply({
            content: `${shortWallet(wallet)} · ${shortSymbol(position.symbol)} — pick another pair below:`,
            embeds: [embed],
            files: [attachment],
            components: rows
          });
        } catch (err) {
          await btnInt.followUp({ content: `Error rendering position card: ${err.message}`, ephemeral: true });
        }
      });

      collector.on("end", async () => {
        const disabledRows = rows.map(row => {
          const cloned = new ActionRowBuilder().addComponents(
            row.components.map(btn => ButtonBuilder.from(btn).setDisabled(true))
          );
          return cloned;
        });
        try {
          await interaction.editReply({ components: disabledRows });
        } catch {
          // message may have been deleted — safe to ignore
        }
      });
    } catch (err) {
      await interaction.editReply(`Error fetching positions: ${err.message}`);
    }
  }
};