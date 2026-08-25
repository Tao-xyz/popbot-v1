'use strict';

const { get, PopdexApiError } = require('./client');

/**
 * getReferralByWallet(wallet)
 * Real endpoint: GET /api/v1/referral/{walletId}/overview
 */
async function getReferralByWallet(wallet) {
  const body = await get(`/api/v1/referral/${wallet}/overview`);
  return body.data;
}

/**
 * getReferralByCode(code)
 * Real endpoints:
 *   GET /api/v1/referral/codes/{code}          -> owner, rebate rate, usage
 *   GET /api/v1/referral/{ownerAddress}/overview -> full summary for that owner
 * We resolve the code to its owner wallet, then fetch that owner's overview
 * so /referral code:XYZ and /referral wallet:0x... return matching shapes.
 */
async function getReferralByCode(code) {
  const codeBody = await get(`/api/v1/referral/codes/${code}`);
  const codeInfo = codeBody.data;
  if (!codeInfo || !codeInfo.ownerAddress) {
    throw new PopdexApiError('Referral code not found.', { endpoint: '/api/v1/referral/codes' });
  }
  const overview = await getReferralByWallet(codeInfo.ownerAddress);
  return { ...overview, codeInfo };
}

module.exports = { getReferralByWallet, getReferralByCode };
