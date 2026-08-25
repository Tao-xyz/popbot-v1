'use strict';

// Personal milestones only — never a global leaderboard.
const MILESTONES = [
  10_000,
  50_000,
  100_000,
  500_000,
  1_000_000,
  5_000_000,
  10_000_000,
  25_000_000,
  50_000_000,
  100_000_000,
  250_000_000,
  500_000_000,
  1_000_000_000,
];

function labelFor(n) {
  if (n >= 1_000_000_000) return `${n / 1_000_000_000}B`;
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1_000) return `${n / 1_000}K`;
  return `${n}`;
}

/**
 * Given a lifetime trading volume figure, returns the last milestone
 * reached and the next milestone to progress toward (or null if the user
 * has already cleared the top tier).
 */
function getMilestoneProgress(totalVolumeUsd) {
  const v = Number(totalVolumeUsd) || 0;
  let reached = null;
  let next = null;
  for (const m of MILESTONES) {
    if (v >= m) reached = m;
    else if (next === null) next = m;
  }
  const progress = next ? Math.min(1, v / next) : 1;
  return {
    reached,
    reachedLabel: reached ? labelFor(reached) : null,
    next,
    nextLabel: next ? labelFor(next) : null,
    progress,
  };
}

module.exports = { MILESTONES, labelFor, getMilestoneProgress };
