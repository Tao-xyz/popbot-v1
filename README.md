# Popdex — a premium Discord-native trading companion

A production-oriented Discord bot for the [Popdex](https://popdex.xyz) DEX,
built with Node.js and discord.js. Every number it shows comes from the
real Popdex REST API — there is no mocked or fabricated market data
anywhere in this codebase (see **Adapter isolation** below for the one
exception the API doc doesn't fully cover).

```
/market [coin]      /oi [coin]           /referral [wallet|code]
/volume [coin]      /news                /positions
/pulse              /tvl [vault]         /performance
/wallet (set/show/clear — see "Wallet linking")
```

> **Note:** `/orders` (recent completed orders) is temporarily disabled —
> its code lives at `src/commands/_disabled/orders.js` and isn't loaded
> or registered as a slash command. Move that file back into
> `src/commands/` to bring it back; nothing else needs to change.

## Quick start

```bash
git clone <this repo>
cd popdex-bot
npm install
cp .env.example .env      # fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, etc.
npm run deploy             # registers slash commands (guild-scoped if
                            # DISCORD_GUILD_ID is set, else global)
npm start
```

### Requirements

- Node.js ≥ 18.17
- `ffmpeg` available on `PATH` **or** the optional
  `@ffmpeg-installer/ffmpeg` package installed (already listed as an
  optional dependency) — only needed for the two **animated** position
  card options.
- The real Popdex brand assets in `assets/` — see `assets/README.md`. The
  bot runs and renders cards without them (with safe fallbacks), but you'll
  want the real logo/fonts/templates before shipping to users.

## Architecture

```
src/
├── config.js              Central env-driven config
├── index.js                Bot entry point — command + component routing
├── deploy-commands.js       Slash command registration script
├── api/                     Popdex API service layer (no Discord code here)
│   ├── client.js             Shared axios client + error normalization
│   ├── market.js              getMarket/getVolume/getOpenInterest/getPulse
│   ├── account.js              getOpenPositions/getPerformance/getOrderHistory
│   ├── referral.js              getReferralByWallet/getReferralByCode
│   ├── vault.js                  getTVL/getVaults/getVaultActivity
│   └── notifications.js           getUpcomingListings/getMarketEvents
│                                    (adapter-isolated — see below)
├── cards/                    Canvas/ffmpeg card renderers (one per card type)
├── commands/                 One file per slash command (thin — calls api/ + cards/)
├── interactions/              Button/select-menu handlers (position card
│                                picker, orders pagination)
└── utils/                     Formatting, error handling, wallet store,
                                 milestone thresholds, short-lived interaction
                                 cache, listing lifecycle tracker
```

API logic is fully separated from Discord logic: nothing in `src/api/`
imports `discord.js`, and nothing in `src/commands/` talks to `axios`
directly. That's intentional, per the brief — you can swap out or extend
any Popdex integration without touching command code.

## Wallet linking (an addition beyond the 10 listed commands)

PopDEX has no OAuth or API-key concept — accounts are identified purely by
wallet address embedded in the URL path (see the API doc's FAQ, Q2). The
original command spec doesn't define how a Discord user's wallet becomes
known to the bot, so I added the minimal piece needed to make
`/positions`, `/performance`, and `/referral` (no-arg form) actually work
for "the user running the command" (`/orders` also used this wallet
linking before it was temporarily disabled — see the note above):

- `/wallet set address:0x...` — links a wallet to the caller's Discord
  account (stored locally in `data/wallets.json`, gitignored).
- `/wallet show` / `/wallet clear`
- Every wallet-scoped command also accepts an explicit `wallet` option, so
  anyone can query any address without linking one.

If you have a different account-linking flow in mind (e.g. a web dashboard
that writes into the same wallet store, or a signed-message verification
step), swap `src/utils/walletStore.js` for your own implementation — every
command reads through `src/utils/resolveWallet.js`.

## Adapter isolation — `/news`

The Popdex API documentation does not expose a dedicated "new listings" or
"market events" feed — only a generic Inbox/Notification message feed
(`GET /web/v1/msg/station/feed`). Rather than inventing fake listing data,
`src/api/notifications.js` pulls the real public Announcement feed and
heuristically classifies each message (upcoming listing / now live /
general) from its title/content text — no coin names are hard-coded
anywhere. This is clearly marked as an **adapter** in the source: when
Popdex exposes (or you're given access to) a proper listings/events
endpoint, only `getUpcomingListings()` and `getMarketEvents()` in that one
file need to change — every command, card, and the listing-lifecycle
tracker (`src/utils/listingTracker.js`, which independently manages the
"track for ~72h then fall back to general news" behavior) stay the same.

## Command-by-command notes

- **`/market [coin]`** — real-time ticker via
  `GET /public/market/tickers`: price, 24h change, 24h volume, OI
  (derived from `openInterest × markPrice`), funding rate, 24h high/low.
- **`/volume [coin]`** — with no coin, shows **only** the sum of 24h
  turnover across all Futures markets (never all-time volume, per spec).
  With a coin, shows that symbol's 24h volume + price movement.
- **`/positions`** — fetches real open positions, then asks the user to
  pick a card design via buttons — all **static PNG** for now (animated
  MP4 designs were removed from the picker; see
  `src/cards/animatedPositionCard.js` if that returns later). Static
  designs are listed in `STATIC_DESIGNS` in `src/commands/positions.js` —
  add an entry (plus a matching `assets/position_N.png`) to add a new
  one. Cards use a **60% data panel / 40% artwork** layout — see
  `assets/README.md` — with a large, dedicated logo row at the top rather
  than a small corner icon. Never shows position size, wallet balance, or
  dollar PnL — only what the spec allows (pair, side, leverage,
  entry/market price, PnL %, liquidation price, referral code if
  available).
- **`/performance`** — 7D/30D/90D/ALL map to Popdex's actual portfolio
  windows (7D/1M/6M/All respectively, since those don't line up 1:1).
  Also shows: an **active days** stat (distinct calendar days with a
  closed trade in the selected window), and a **trading-tier badge**
  (10K/50K/100K/500K/1M/5M/10M/25M/50M/100M/250M/500M/1B —
  `src/utils/milestones.js`) plus a progress bar toward the next tier.
  Both the badge and the progress bar are driven by **lifetime** trading
  volume (fetched at the `All` scope regardless of the selected display
  window), and both are personal — never a global leaderboard.
- **`/pulse`** — one screen: top-volume market, biggest mover, biggest OI
  market, all derived from the live Futures ticker list. "Biggest OI" is
  computed in **USD** (`openInterest × markPrice`, same formula as
  `/market`) rather than raw contract count, since contract counts aren't
  comparable across symbols with very different prices.
- **`/oi [coin]`** — total OI + top 5 markets, or a single symbol's OI.
  24h OI *movement* isn't exposed by the API, so it's shown as "—" rather
  than a fabricated number.
- **`/news`** — leads with a **daily market recap** paragraph card (top
  gainer(s), 24h volume leader + platform total, OI leader — all from
  real ticker data via `market.getDailyMarketStats()`), so `/news` always
  shows something even on a day with no matching announcements. A
  liquidation sentence is appended only when real data is available —
  the documented Popdex API doesn't expose a liquidations feed, so
  `notifications.getLiquidationSummary()` is a stub returning `null`
  rather than inventing a figure; wire up a real endpoint there if one
  becomes available. After the recap, any real upcoming-listing /
  live-listing / general announcement items (see "Adapter isolation"
  above — this also covers e.g. RWA-related announcements, since nothing
  here filters by asset category) fill the remaining card slots.
- **`/referral [wallet|code]`** — implements `getReferralByWallet` and
  `getReferralByCode` as separate functions per spec; never shows
  milestones, ranking, or status — only code, totals, deposited users,
  active traders, and referral-generated volume.
- **`/orders`** — **temporarily disabled.** Code lives at
  `src/commands/_disabled/orders.js` (last 10 completed orders,
  Previous/Next/Refresh pagination, never shows position size or dollar
  PnL) — move it back into `src/commands/` to re-enable; nothing else
  needs to change.
- **`/tvl [vault]`** — platform overview (sum of all vault equity — the
  API has no single "platform TVL" figure) or a dedicated per-vault card
  with its own layout (not a re-skinned Market Card).

## Error handling

Every command is wrapped in `src/utils/errors.js#safeHandler`: raw errors
(HTTP failures, timeouts, malformed responses) are logged server-side only
and replaced with a short, clean message in Discord. API keys/tokens are
never in play (Popdex has none — see FAQ Q2), but Discord tokens and any
future secrets stay in `.env`, which is gitignored.

## Known limitations / next steps

- Real brand assets (logo, licensed Arial `.ttf` files, animated MP4
  templates) are not included — see `assets/README.md`.
- `/news`'s listing detection is heuristic text-matching against the
  public Announcement feed, isolated behind an adapter (see above) for a
  clean swap once a real listings endpoint is available.
- `/news`'s liquidation sentence never appears yet because the
  documented Popdex API has no liquidations feed —
  `notifications.getLiquidationSummary()` is a stub returning `null`.
  Swap in a real implementation there once one's available.
- Wallet linking is a minimal local JSON store — fine for a single-process
  bot, but swap it for a real datastore before scaling horizontally.
