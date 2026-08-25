'use strict';

/**
 * ASSUMPTION: PopDEX has no OAuth/API-key concept — private endpoints are
 * addressed purely by wallet address in the URL path (see FAQ Q2). The
 * command spec you provided (/positions, /performance, /orders) doesn't
 * define how a Discord user's wallet is known to the bot, so this module
 * adds the minimal piece needed to make those commands work: a persisted
 * Discord-user -> wallet-address mapping, set once via `/wallet set` and
 * reused afterward. Every wallet-scoped command also accepts an explicit
 * `wallet` option so a user can query any address without linking one.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const FILE = path.join(config.paths.data, 'wallets.json');

function ensureFile() {
  if (!fs.existsSync(config.paths.data)) fs.mkdirSync(config.paths.data, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({}), 'utf8');
}

function load() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  ensureFile();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

function isValidWallet(address) {
  return typeof address === 'string' && WALLET_RE.test(address);
}

function setWallet(discordUserId, walletAddress) {
  if (!isValidWallet(walletAddress)) throw new Error('Invalid wallet address format.');
  const data = load();
  data[discordUserId] = walletAddress;
  save(data);
}

function getWallet(discordUserId) {
  const data = load();
  return data[discordUserId] || null;
}

function clearWallet(discordUserId) {
  const data = load();
  delete data[discordUserId];
  save(data);
}

module.exports = { setWallet, getWallet, clearWallet, isValidWallet };
