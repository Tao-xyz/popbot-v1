'use strict';

const axios = require('axios');
const config = require('../config');

/**
 * Thrown for any failure talking to the Popdex API (network, timeout,
 * non-200 "code", or unexpected shape). Command handlers catch this and
 * show the user a clean message while the raw error is logged internally.
 */
class PopdexApiError extends Error {
  constructor(message, { cause, status, code, endpoint } = {}) {
    super(message);
    this.name = 'PopdexApiError';
    this.cause = cause;
    this.status = status;
    this.code = code;
    this.endpoint = endpoint;
  }
}

const http = axios.create({
  baseURL: config.popdex.restBase,
  timeout: config.popdex.httpTimeoutMs,
  headers: {
    'Content-Type': 'application/json',
    language: config.popdex.language,
  },
});

/**
 * GET wrapper that unwraps Popdex's { code, msg, data } envelope and
 * normalizes every failure mode into a PopdexApiError. Never throws raw
 * axios errors up to command code, and never leaks internal error detail
 * to the caller (that's the caller's job, using .message).
 */
async function get(endpoint, { params = {}, timeout } = {}) {
  try {
    const res = await http.get(endpoint, { params, timeout });
    const body = res.data;

    if (!body || typeof body !== 'object') {
      throw new PopdexApiError('Popdex returned an unexpected response.', { endpoint });
    }
    if (body.code !== '200' && body.code !== 200) {
      throw new PopdexApiError(body.msg || 'Popdex API returned an error.', {
        code: body.code,
        endpoint,
      });
    }
    return body;
  } catch (err) {
    if (err instanceof PopdexApiError) throw err;
    if (err.code === 'ECONNABORTED') {
      throw new PopdexApiError('Popdex API request timed out.', { cause: err, endpoint });
    }
    if (err.response) {
      throw new PopdexApiError(`Popdex API responded with HTTP ${err.response.status}.`, {
        cause: err,
        status: err.response.status,
        endpoint,
      });
    }
    throw new PopdexApiError('Could not reach the Popdex API.', { cause: err, endpoint });
  }
}

module.exports = { http, get, PopdexApiError };
