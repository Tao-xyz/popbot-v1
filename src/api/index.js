'use strict';

const market = require('./market');
const account = require('./account');
const referral = require('./referral');
const vault = require('./vault');
const notifications = require('./notifications');
const { PopdexApiError } = require('./client');

module.exports = {
  // Market
  getMarket: market.getMarketBySymbol,
  getMarketBySymbol: market.getMarketBySymbol,
  getVolume: market.getVolume,
  getVolumeBySymbol: market.getVolumeBySymbol,
  getOpenInterest: market.getOpenInterest,
  getOpenInterestBySymbol: market.getOpenInterestBySymbol,
  getPulse: market.getPulse,

  // Account
  getOpenPositions: account.getOpenPositions,
  getPerformance: account.getPerformance,
  getOrderHistory: account.getOrderHistory,

  // Referral
  getReferralByWallet: referral.getReferralByWallet,
  getReferralByCode: referral.getReferralByCode,

  // Vault / TVL
  getTVL: vault.getTVL,
  getVaults: vault.getVaults,
  getVaultActivity: vault.getVaultActivity,

  // Notifications (adapter-isolated — see api/notifications.js)
  getUpcomingListings: notifications.getUpcomingListings,
  getMarketEvents: notifications.getMarketEvents,

  PopdexApiError,
};
