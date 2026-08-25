// referral.js
// ---------------------------------------------------------------------------
// /referral command — look up a PopDEX referral card by REFERRAL CODE
// *or* by wallet address, and render it as the branded PNG card shown in
// the reference screenshot:
//
//   PopDEX Referrals
//   0x9E58...4428
//   ┌─────────── REFERRAL CODE ───────────┐
//   │             PB41FGD                 │
//   └──────────────────────────────────────┘
//   [Total Referrals] [Traded Referrals] [Referrals' Trading Volume] [Referee's Reward Share]
//
// HOW CODE-SEARCH WORKS
// ----------------------
// The overview endpoint (GET /referral/{walletId}/overview) only accepts a
// wallet address — there's no "overview by code" endpoint. So when the
// input isn't a wallet address, this resolves it in two hops:
//   1. GET /referral/codes/{code}   -> { ownerAddress, ... }   (public, no auth)
//   2. GET /referral/{ownerAddress}/overview -> full referral overview
// Both calls already exist in popdexApi.js (getReferralCodeInfo /
// getReferralOverview) — this file just chains them and maps the result
// onto renderStatsCard's row format.
//
// FRAMEWORK ASSUMPTION
// ----------------------
// No bot framework file was provided, so this is written as a Discord.js
// v14 slash command (the { data, execute } shape Discord.js expects in a
// commands/ folder). All the actual logic lives in the framework-agnostic
// `buildReferralCard()` export below — if this is actually for Telegram,
// a REST route, etc., ignore `data`/`execute` and just call
// `buildReferralCard(input)` from your own handler; it returns a PNG Buffer.
// ---------------------------------------------------------------------------

const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const popdex = require("../popdexApi");
const { renderStatsCard } = require("../cardRenderer");

// Matches a raw EVM wallet address. Anything that doesn't match this is
// treated as a referral code instead.
const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;

function shortenWallet(address) {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Renders a USD stat like the reference card's "$0" / "$1,234.56" values.
// totalReferralVolume / totalRewards come back from the API as plain
// decimal strings (no currency symbol, no thousands separators).
function formatUsd(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return `$${value ?? "0"}`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/**
 * Resolves user input down to a wallet address.
 *  - "0x" + 40 hex chars -> used as-is, no extra API call.
 *  - anything else -> looked up via GET /referral/codes/{code}, which
 *    returns `ownerAddress` for a valid, existing code.
 *
 * @param {string} input - referral code or wallet address, as typed by the user
 * @returns {Promise<string>} resolved wallet address
 * @throws if the string is treated as a code and no such code exists
 */
async function resolveWalletAddress(input) {
  const trimmed = String(input).trim();

  if (WALLET_REGEX.test(trimmed)) {
    return trimmed;
  }

  const codeRes = await popdex.getReferralCodeInfo(trimmed);
  const ownerAddress = codeRes?.data?.ownerAddress;
  if (!ownerAddress) {
    throw new Error(`Referral code "${trimmed}" doesn't exist.`);
  }
  return ownerAddress;
}

/**
 * Full lookup + render pipeline: resolves the input, pulls the referral
 * overview, and returns a PNG card matching the reference layout.
 *
 * @param {string} input - referral code (e.g. "PH913UD") or wallet address (0x...)
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function buildReferralCard(input) {
  const walletAddress = await resolveWalletAddress(input);

  // The percentage is editable independently of the referral code, so always
  // retrieve a fresh overview rather than the 30-second cached response.
  const overviewRes = await popdex.getReferralOverview(walletAddress, { fresh: true });
  const overview = overviewRes.data;

  const referralCode = overview.referralCode?.referralCode;
  if (!referralCode) {
    throw new Error(`${shortenWallet(walletAddress)} hasn't created a referral code yet.`);
  }

  const summary = overview.summary || {};

  const rows = [
    // Hero box — big centered "REFERRAL CODE" value, matches the reference image
    { label: "Referral Code", value: referralCode, hero: true },

    // Two small stat chips, side by side (2-col grid = same combined
    // width as the hero box above them)
    { label: "Total Referrals", value: summary.totalReferrals ?? "0" },
    { label: "Traded Referrals", value: summary.tradedInvitees ?? "0" },

    // `wide: true` makes this its own full-width row instead of a third,
    // narrower grid chip — so it lines up edge-to-edge with the Referral
    // Code box above it rather than sitting at 1/3 width with dead space
    // beside it. `center: true` centers the label/value inside that box
    // (matching the hero box above) instead of the default left-aligned
    // "position row" style.
    { label: "Referrals' Trading Volume", value: formatUsd(summary.totalReferralVolume ?? "0"), wide: true, center: true }
  ];

  return renderStatsCard({
    title: "PopDEX Referrals",
    subtitle: shortenWallet(walletAddress),
    rows,
    footer: "Data from api.popdex.xyz",
    // Shifted 10% leftward: widens the stat grid from the default 68% of
    // card width to 78%, so there's less empty space on the right and the
    // hero/chip/wide boxes all sit further left as a group.
    contentWidthRatio: 0.62
  });
}

// ---------------------------------------------------------------------------
// Discord.js slash command wrapper
// ---------------------------------------------------------------------------

const data = new SlashCommandBuilder()
  .setName("referral")
  .setDescription("Look up a PopDEX referral card by referral code or wallet address")
  .addStringOption(option =>
    option
      .setName("code_or_wallet")
      .setDescription("Referral code (e.g. PH913UD) or wallet address (0x...)")
      .setRequired(true)
  );

async function execute(interaction) {
  const input = interaction.options.getString("code_or_wallet", true);
  await interaction.deferReply();

  try {
    const png = await buildReferralCard(input);
    const attachment = new AttachmentBuilder(png, { name: "referral-card.png" });
    await interaction.editReply({ files: [attachment] });
  } catch (err) {
    await interaction.editReply(`Couldn't build a referral card for "${input}": ${err.message}`);
  }
}

module.exports = {
  data,
  execute,
  buildReferralCard,
  resolveWalletAddress
};