'use strict';

const { AttachmentBuilder } = require('discord.js');
const { newCanvas, loadAsset, drawBackground, drawLogo, drawFooter, drawText, drawPill, ensureFonts } = require('./canvasUtils');
const fmt = require('../utils/format');

const W = 720;
const H = 420;
const MARGIN = 32;

/**
 * Renders a standalone Referral Card — independent from the Position
 * Card's small in-grid referral field. Big referral code up top, then a
 * clean stat grid (Total Referrals, Deposited Users, Active Traders,
 * Referral-Generated Volume). All headings are full white, no dimmed/gray
 * tone, per spec.
 */
async function renderReferralCard(overview, { wallet } = {}) {
  const { fontFamily, fontFamilyBold } = ensureFonts();
  const { canvas, ctx } = newCanvas(W, H);
  const bg = await loadAsset('market.png');
  drawBackground(ctx, W, H, bg);
  await drawLogo(ctx, { x: MARGIN, y: 26, height: 52 });

  const summary = overview.summary || {};
  const referralCode = overview.referralCode?.referralCode || overview.codeInfo?.referralCode || '—';

  drawText(ctx, 'POPDEX REFERRAL', MARGIN, 116, {
    font: `700 15px "${fontFamilyBold}"`,
    color: '#FFFFFF',
  });

  drawText(ctx, referralCode, MARGIN, 176, {
    font: `800 44px "${fontFamilyBold}"`,
    color: '#FFFFFF',
  });

  if (wallet) {
    drawText(ctx, `Wallet ${fmt.shortAddr(wallet)}`, MARGIN, 202, {
      font: `600 14px "${fontFamily}"`,
      color: '#FFFFFF',
    });
  }

  const rebateRate = overview.codeInfo?.rebateRate;
  if (rebateRate !== undefined && rebateRate !== null) {
    drawPill(ctx, `${fmt.pctFromFraction(rebateRate, { signed: false })} REBATE`, {
      right: W - MARGIN,
      top: 96,
      font: `700 14px "${fontFamilyBold}"`,
      textColor: '#FFFFFF',
      bg: 'rgba(125, 249, 255, 0.18)',
    });
  }

  const stats = [
    ['TOTAL REFERRALS', summary.totalReferrals ?? '—'],
    ['DEPOSITED USERS', summary.depositedInvitees ?? '—'],
    ['ACTIVE TRADERS', summary.tradedInvitees ?? '—'],
    ['REFERRAL VOLUME', summary.totalReferralVolume ? fmt.usd(summary.totalReferralVolume, { compact: true }) : '—'],
  ];
  const cols = 2;
  const colW = (W - MARGIN * 2) / cols;
  const gridTop = 268;
  const rowH = 78;
  stats.forEach(([label, value], i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * colW;
    const y = gridTop + row * rowH;
    drawText(ctx, label, x, y, { font: `700 13px "${fontFamilyBold}"`, color: '#FFFFFF' });
    drawText(ctx, String(value), x, y + 30, { font: `800 24px "${fontFamilyBold}"`, color: '#FFFFFF' });
  });

  drawFooter(ctx, W, H);
  const buffer = await canvas.encode('png');
  return new AttachmentBuilder(buffer, { name: 'referral-card.png' });
}

module.exports = { renderReferralCard };
