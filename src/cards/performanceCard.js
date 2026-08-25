'use strict';

// This file used to contain its own copy of renderPerformanceCard with an
// outdated gradient background — a leftover duplicate of the real
// implementation in src/commands/performance.js. Re-exporting from there
// instead, so there is only ever one source of truth for this card.
module.exports = require('../commands/performance').renderPerformanceCard
  ? { renderPerformanceCard: require('../commands/performance').renderPerformanceCard }
  : require('../commands/performance');