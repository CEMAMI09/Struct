'use strict'
const TRANSIENT_HTTP = new Set([408, 429])
function retryAfter(value, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 128) return null
  const trimmed = value.trim()
  const seconds = /^\d+$/.test(trimmed)
    ? Number(trimmed)
    : (Date.parse(trimmed) - now) / 1000
  return Number.isFinite(seconds)
    ? Math.ceil(Math.min(3600, Math.max(0, seconds)))
    : null
}
function classifyResponse(status) {
  if (Number.isInteger(status) && status >= 200 && status < 300)
    return { outcome: 'delivered', category: null, detail: `HTTP ${status}` }
  if (TRANSIENT_HTTP.has(status) || (status >= 500 && status <= 599))
    return {
      outcome: 'retry',
      category: 'http_transient',
      detail: `HTTP ${status}`,
    }
  return {
    outcome: 'dead',
    category: 'http_permanent',
    detail: `HTTP ${status || 'invalid response'}`,
  }
}
function classifyError(error) {
  if (
    error?.code === 'WEBHOOK_POLICY' ||
    [
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'CERT_HAS_EXPIRED',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'CERT_NOT_YET_VALID',
      'ERR_INVALID_URL',
    ].includes(error?.code)
  )
    return {
      outcome: 'dead',
      category: 'configuration',
      detail:
        'Destination violates HTTPS/public-address, certificate or request-size policy',
    }
  if (
    ['AbortError', 'TimeoutError'].includes(error?.name) ||
    ['ABORT_ERR', 'ETIMEDOUT'].includes(error?.code)
  )
    return {
      outcome: 'retry',
      category: 'timeout',
      detail: 'Request timed out; the receiver may have processed the event',
    }
  if (['EAI_AGAIN', 'ENOTFOUND'].includes(error?.code))
    return {
      outcome: 'retry',
      category: 'dns',
      detail: 'Destination DNS is temporarily unavailable',
    }
  return {
    outcome: 'retry',
    category: 'network',
    detail: 'Destination connection failed; remote outcome may be unknown',
  }
}
const TRANSITIONS = Object.freeze({
  pending: ['sending', 'dead', 'skipped'],
  sending: ['pending', 'delivered', 'dead', 'skipped'],
  dead: ['pending'],
  delivered: ['pending'],
  skipped: ['pending'],
})
function validTransition(from, to) {
  return TRANSITIONS[from]?.includes(to) === true
}
module.exports = {
  retryAfter,
  classifyResponse,
  classifyError,
  TRANSITIONS,
  validTransition,
}
