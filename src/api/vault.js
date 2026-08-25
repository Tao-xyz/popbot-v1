'use strict';

const { get, PopdexApiError } = require('./client');

/**
 * getVaults()
 * Real endpoint: GET /api/v1/vaults
 */
async function getVaults({ vaultType, includeSubVaults = false, limit = 50 } = {}) {
  const body = await get('/api/v1/vaults', { params: { vaultType, includeSubVaults, limit } });
  return Array.isArray(body.data) ? body.data : [];
}

/**
 * getTVL()
 * There is no single "platform TVL" endpoint, so total TVL is the sum of
 * totalEquity across all vaults (protocol + user). 24H TVL change is not
 * exposed by the API, so it is left null rather than fabricated.
 * Real endpoint: GET /api/v1/vaults
 */
async function getTVL() {
  const vaults = await getVaults({ limit: 100 });
  const totalTvl = vaults.reduce((sum, v) => sum + Number(v.totalEquity || 0), 0);
  const topVaults = [...vaults]
    .sort((a, b) => Number(b.totalEquity || 0) - Number(a.totalEquity || 0))
    .slice(0, 5);
  return { totalTvl, vaultCount: vaults.length, topVaults };
}

/**
 * Resolve a human-entered vault name to its vaultWalletId.
 */
async function findVaultByName(name) {
  const vaults = await getVaults({ limit: 100, includeSubVaults: true });
  const needle = name.trim().toLowerCase();
  const match = vaults.find(
    (v) => v.name?.toLowerCase() === needle || v.vaultWalletId?.toLowerCase() === needle
  );
  if (!match) {
    // Fall back to partial match for convenience.
    return vaults.find((v) => v.name?.toLowerCase().includes(needle)) || null;
  }
  return match;
}

/**
 * getVaultActivity(vaultNameOrAddress)
 * Real endpoints:
 *   GET /api/v1/vault/{vaultWalletId}/overview
 *   GET /api/v1/vault/{vaultWalletId}/history/funds-transfer (deposits/withdrawals)
 */
async function getVaultActivity(vaultNameOrAddress) {
  const vault = vaultNameOrAddress.startsWith('0x')
    ? { vaultWalletId: vaultNameOrAddress }
    : await findVaultByName(vaultNameOrAddress);

  if (!vault) {
    throw new PopdexApiError('Vault not found.', { endpoint: '/api/v1/vaults' });
  }

  const [overviewBody, transfersBody, listBody] = await Promise.all([
    get(`/api/v1/vault/${vault.vaultWalletId}/overview`),
    get(`/api/v1/vault/${vault.vaultWalletId}/history/funds-transfer`, {
      params: { limit: 50 },
    }),
    getVaults({ limit: 100, includeSubVaults: true }),
  ]);

  const meta = listBody.find((v) => v.vaultWalletId === vault.vaultWalletId) || vault;
  const transfers = Array.isArray(transfersBody.data) ? transfersBody.data : [];

  const deposits = transfers.filter((t) => t.type === 'VaultDeposit');
  const withdrawals = transfers.filter((t) => t.type === 'VaultWithdraw');
  const depositTotal = deposits.reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const withdrawTotal = withdrawals.reduce((sum, t) => sum + Number(t.amount || 0), 0);

  return {
    meta,
    overview: overviewBody.data,
    deposits,
    withdrawals,
    depositTotal,
    withdrawTotal,
    recentActivity: transfers.slice(0, 8),
  };
}

module.exports = { getVaults, getTVL, getVaultActivity, findVaultByName };
