'use strict';

const crypto = require('crypto');

const TTL_MS = 5 * 60 * 1000;
const store = new Map();

function put(value) {
  const token = crypto.randomUUID().slice(0, 8);
  store.set(token, { value, expiresAt: Date.now() + TTL_MS });
  return token;
}

function get(token) {
  const entry = store.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(token);
    return null;
  }
  return entry.value;
}

/**
 * Overwrites the value for an existing token (refreshing its TTL) without
 * minting a new token — used by paginated components so the buttons on an
 * already-sent message keep referencing a valid token across pages.
 */
function set(token, value) {
  store.set(token, { value, expiresAt: Date.now() + TTL_MS });
}

// Periodic sweep so the cache never grows unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of store.entries()) {
    if (now > entry.expiresAt) store.delete(token);
  }
}, 60 * 1000).unref();

module.exports = { put, get, set };
