'use strict';

const { SlashCommandBuilder } = require('discord.js');
const notifications = require('../api/notifications');
const market = require('../api/market');
const listingTracker = require('../utils/listingTracker');
const {
  renderUpcomingListingCard,
  renderLiveListingCard,
  renderMarketEventCard,
  renderDailyNewsCard,
} = require('../cards/newsCard');
const fmt = require('../utils/format');
const { safeHandler } = require('../utils/errors');

const MAX_CARDS = 4;

function pctText(t) {
  // fmt.pctFromFraction already prepends '+' for positive values — don't
  // double it up.
  return fmt.pctFromFraction(t.price24hPcnt);
}

/**
 * Builds the daily recap as one readable paragraph — top gainer(s),
 * 24h volume, the OI leader, and (only if real data is available) a
 * liquidation sentence. Every figure here comes from live ticker data;
 * nothing is invented, and a missing section is simply left out instead
 * of being filled with a placeholder number.
 */
function buildDailyParagraph(stats, liquidation) {
  const sentences = [];

  if (stats?.topGainers?.length) {
    const [first, ...rest] = stats.topGainers;
    let s = `${first.symbol} is today's top gainer, up ${pctText(first)} over the last 24 hours.`;
    if (rest.length) {
      const others = rest.slice(0, 3).map((t) => `${t.symbol} (${pctText(t)})`).join(', ');
      s += ` Other movers include ${others}.`;
    }
    sentences.push(s);
  } else {
    sentences.push('No coin is showing a positive 24h move right now — the market is broadly red.');
  }

  if (stats?.topLoser && Number(stats.topLoser.price24hPcnt) < 0) {
    sentences.push(`On the downside, ${stats.topLoser.symbol} is the biggest faller, down ${pctText(stats.topLoser)}.`);
  }

  if (stats?.topVolume) {
    const totalVol = fmt.usd(stats.totalVolume24h, { compact: true });
    sentences.push(
      `${stats.topVolume.symbol} leads 24h trading volume at ${fmt.usd(stats.topVolume.turnover24h, { compact: true })}, out of ${totalVol} traded across the platform in the last 24 hours.`
    );
  }

  if (stats?.oiLeader && stats.oiLeaderUsd != null) {
    sentences.push(`${stats.oiLeader.symbol} holds the highest open interest at ${fmt.usd(stats.oiLeaderUsd, { compact: true })}.`);
  }

  // Only added when getLiquidationSummary() returns real data — see the
  // adapter note in src/api/notifications.js for why this is usually null.
  if (liquidation) {
    const dir = liquidation.dominantSide ? liquidation.dominantSide.toLowerCase() : null;
    sentences.push(
      `The biggest liquidation event in the last 24 hours was ${liquidation.topCoin || 'the market'}, with ${fmt.usd(
        liquidation.total24h,
        { compact: true }
      )} liquidated total${dir ? `, led by ${dir} positions` : ''}.`
    );
  }

  return sentences.join(' ');
}

module.exports = {
  data: new SlashCommandBuilder().setName('news').setDescription('Latest Popdex market news and listings'),

  execute: safeHandler(async (interaction) => {
    await interaction.deferReply();

    const [stats, liquidation, upcoming, events] = await Promise.all([
      market.getDailyMarketStats(),
      notifications.getLiquidationSummary(),
      notifications.getUpcomingListings(),
      notifications.getMarketEvents({ limit: 30 }),
    ]);

    const cards = [];
    const seenIds = new Set();

    // 1) Daily market recap paragraph — always shown when ticker data is
    //    available, so /news is never empty just because there happen to
    //    be no matching announcements today.
    if (stats) {
      const paragraph = buildDailyParagraph(stats, liquidation);
      const dateLabel = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      cards.push(await renderDailyNewsCard(paragraph, { dateLabel }));
    }

    // 2) Upcoming listings next.
    for (const item of upcoming) {
      if (cards.length >= MAX_CARDS) break;
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      cards.push(await renderUpcomingListingCard(item));
    }

    // 3) Live-listing events: mark tracking start, show live card while
    //    inside the 72h window; otherwise fold into general news below.
    if (cards.length < MAX_CARDS) {
      const liveEvents = events.filter((e) => e.category === 'listing_live');
      for (const item of liveEvents) {
        if (cards.length >= MAX_CARDS) break;
        if (seenIds.has(item.id)) continue;
        listingTracker.markLiveIfNew(item.symbol);
        if (!listingTracker.isWithinTrackingWindow(item.symbol)) continue; // moved to general news
        seenIds.add(item.id);
        let ticker = null;
        if (item.symbol) {
          try {
            ticker = await market.getMarketBySymbol(item.symbol);
          } catch {
            ticker = null;
          }
        }
        cards.push(await renderLiveListingCard(item, ticker));
      }
    }

    // 4) General market news (everything else, including expired
    //    listings and any other announcement-feed items — e.g. RWA
    //    listing/market announcements land here too, since nothing here
    //    filters by asset category).
    if (cards.length < MAX_CARDS) {
      const general = events.filter((e) => !seenIds.has(e.id));
      for (const item of general) {
        if (cards.length >= MAX_CARDS) break;
        seenIds.add(item.id);
        cards.push(await renderMarketEventCard(item));
      }
    }

    if (cards.length === 0) {
      await interaction.editReply('No news right now.');
      return;
    }

    await interaction.editReply({ files: cards });
  }),
};
