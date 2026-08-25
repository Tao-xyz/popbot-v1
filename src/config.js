'use strict';

require('dotenv').config();
const path = require('path');

function required(name) {
  const v = process.env[name];
  if (!v) {
    // eslint-disable-next-line no-console
    console.warn(`[config] Missing env var ${name} — set it in .env before running the bot.`);
  }
  return v;
}

const network = (process.env.POPDEX_NETWORK || 'mainnet').toLowerCase();

const restBase =
  network === 'testnet'
    ? process.env.POPDEX_REST_BASE_TESTNET || 'https://testnet-api.popdex.xyz'
    : process.env.POPDEX_REST_BASE_MAINNET || 'https://api.popdex.xyz';

const wsBase =
  network === 'testnet'
    ? process.env.POPDEX_WS_BASE_TESTNET || 'wss://testnet-ws.popdex.xyz/v1/ws/public'
    : process.env.POPDEX_WS_BASE_MAINNET || 'wss://ws.popdex.xyz/v1/ws/public';

module.exports = {
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId: process.env.DISCORD_GUILD_ID || null,
  },
  popdex: {
    network,
    restBase,
    wsBase,
    language: process.env.POPDEX_LANGUAGE || 'en_US',
    httpTimeoutMs: Number(process.env.POPDEX_HTTP_TIMEOUT_MS || 8000),
  },
  cache: {
    configTtlMs: Number(process.env.CONFIG_CACHE_TTL_MS || 60000),
  },
  paths: {
    root: path.resolve(__dirname, '..'),
    assets: path.resolve(__dirname, '..', 'assets'),
    fonts: path.resolve(__dirname, '..', 'assets', 'fonts'),
    data: path.resolve(__dirname, '..', 'data'),
  },
  branding: {
    footer: 'Trade on app.popdex.xyz',
    white: '#FFFFFF',
    // Popdex brand backdrop tone used behind cards; overridden per-card asset.
    accent: '#7DF9FF',
  },
};