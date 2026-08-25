'use strict';

const walletStore = require('./walletStore');

/**
 * Resolves the wallet to use for a wallet-scoped command: an explicit
 * `wallet` option wins, otherwise falls back to the user's linked wallet
 * (see /wallet set). Throws a friendly error if neither is available.
 */
function resolveWallet(interaction, explicitWallet) {
  if (explicitWallet) {
    if (!walletStore.isValidWallet(explicitWallet)) {
      throw new Error('That doesn’t look like a valid wallet address (expected 0x… + 40 hex chars).');
    }
    return explicitWallet;
  }
  const linked = walletStore.getWallet(interaction.user.id);
  if (!linked) {
    throw new Error('No wallet linked. Use `/wallet set` first, or pass a `wallet` option.');
  }
  return linked;
}

module.exports = { resolveWallet };
