# PopDEX Wallet Bot

Discord bot for tracking PopDEX wallet stats directly in a server channel.

## Commands

- `/wallet <address>` — balance, token holdings, open positions, 24h volume
- `/performance <address> [window]` — PnL, drawdown, equity, volume over 24H/7D/1M/6M/All
- `/history <address>` — recent closed trades, ROI, win rate
- `/oi [symbol]` — open interest for one pair or all pairs

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in:
   - `DISCORD_TOKEN` — from the Discord Developer Portal (Bot tab)
   - `CLIENT_ID` — your application's Client ID (General Information tab)
   - `GUILD_ID` — the Discord server ID where you want to test commands
   - `POPDEX_API_BASE` — defaults to `https://api.popdex.xyz/api/v1`; change only if using a proxy

3. Invite the bot to your server with `applications.commands` and `bot` scopes, with permission to send messages and embed links.

4. Deploy the slash commands (guild-scoped = instant):
   ```
   npm run deploy-commands
   ```

5. Start the bot:
   ```
   npm start
   ```

## Deploying to Railway

Same pattern as your existing pop-bot-v2:
1. Push this folder to a GitHub repo
2. Connect the repo in Railway
3. Add the same `.env` variables in Railway's Variables tab
4. Railway will run `npm start` automatically

## Notes

- **Caching**: API responses are cached in memory for 30 seconds per wallet/query to avoid hitting the shared IP rate limit (1,200 weight / 60s across your whole bot).
- **Not yet wired in**: Referral endpoints (`Get Referral Overview`, `Get Referral Code`, `Get Referral Invitees`) and platform-wide `Get Tickers` / funding rate — add these once you've confirmed their exact response shape from the docs.
- **Unique wallets traded/deposited**: not available via REST. Requires a separate on-chain indexer reading `TokenBridge` and `Order` contract events — not included in this bot yet.
- This bot calls the PopDEX API directly from Node.js (server-side), so it does not need a CORS proxy — that issue only affects browser-based fetches.
