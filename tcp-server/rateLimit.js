/**
 * In-memory DDoS / spam rate limiter for the TCP ingestion path.
 *
 * Two sliding-window trackers:
 *   - Per IP: max connections per second (default 10)
 *   - Per API key: max payloads per minute (default 50)
 *
 * Override with env:
 *   TCP_IP_CONN_LIMIT_PER_SEC
 *   TCP_PAYLOAD_LIMIT_PER_MIN
 */

function positiveLimit(value, fallback) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
    throw new Error('Rate-limit settings must be positive integers')
  }
  return parsed
}

const IP_CONN_LIMIT = positiveLimit(process.env.TCP_IP_CONN_LIMIT_PER_SEC, 10)
const UDP_IP_DATAGRAM_LIMIT = positiveLimit(process.env.UDP_IP_DATAGRAM_LIMIT_PER_SEC, 200)
const IP_WINDOW_MS = 1000
const PAYLOAD_LIMIT = positiveLimit(process.env.TCP_PAYLOAD_LIMIT_PER_MIN, 50)
const PAYLOAD_WINDOW_MS = 60_000
const CLEANUP_INTERVAL_MS = 60_000
const MAX_TRACKED_IPS = 8192

/** Custom downlink: 0xFF (custom) + 0xE1 (rate limited — back off) */
const RATE_LIMIT_DOWNLINK_HEX = 'ffe1'

/** @type {Map<string, number[]>} */
const ipConnections = new Map()

/** @type {Map<string, number[]>} */
const udpDatagrams = new Map()

/** @type {Map<string, number[]>} */
const apiKeyPayloads = new Map()

function normalizeIp(address) {
  if (!address) return 'unknown'
  if (address.startsWith('::ffff:')) return address.slice(7)
  return address
}

function pruneTimestamps(timestamps, windowMs, now) {
  const cutoff = now - windowMs
  while (timestamps.length && timestamps[0] <= cutoff) {
    timestamps.shift()
  }
}

/**
 * @param {string} ip
 * @returns {{ allowed: boolean }}
 */
function checkIpConnection(ip) {
  const now = Date.now()
  const key = normalizeIp(ip)
  let timestamps = ipConnections.get(key)
  if (!timestamps) {
    if (ipConnections.size >= MAX_TRACKED_IPS) sweepRateLimitMaps()
    if (ipConnections.size >= MAX_TRACKED_IPS) return { allowed: false }
    timestamps = []
    ipConnections.set(key, timestamps)
  }
  pruneTimestamps(timestamps, IP_WINDOW_MS, now)

  if (timestamps.length >= IP_CONN_LIMIT) {
    return { allowed: false }
  }

  timestamps.push(now)
  return { allowed: true }
}

/** A looser coarse gate for UDP bursts from many devices behind one NAT. */
function checkUdpDatagram(ip) {
  const now = Date.now()
  const key = normalizeIp(ip)
  let timestamps = udpDatagrams.get(key)
  if (!timestamps) {
    if (udpDatagrams.size >= MAX_TRACKED_IPS) sweepRateLimitMaps()
    if (udpDatagrams.size >= MAX_TRACKED_IPS) return { allowed: false }
    timestamps = []
    udpDatagrams.set(key, timestamps)
  }
  pruneTimestamps(timestamps, IP_WINDOW_MS, now)
  if (timestamps.length >= UDP_IP_DATAGRAM_LIMIT) return { allowed: false }
  timestamps.push(now)
  return { allowed: true }
}

/**
 * @param {string} apiKey
 * @returns {{ allowed: boolean, retryAfterMs: number }}
 */
function checkPayloadRateLimit(apiKey) {
  const now = Date.now()
  let timestamps = apiKeyPayloads.get(apiKey)
  if (!timestamps) {
    timestamps = []
    apiKeyPayloads.set(apiKey, timestamps)
  }
  pruneTimestamps(timestamps, PAYLOAD_WINDOW_MS, now)

  if (timestamps.length >= PAYLOAD_LIMIT) {
    const oldest = timestamps[0]
    const retryAfterMs = Math.max(0, PAYLOAD_WINDOW_MS - (now - oldest) + 1)
    return { allowed: false, retryAfterMs }
  }

  timestamps.push(now)
  return { allowed: true, retryAfterMs: 0 }
}

function sweepRateLimitMaps() {
  const now = Date.now()
  for (const [ip, timestamps] of ipConnections) {
    pruneTimestamps(timestamps, IP_WINDOW_MS, now)
    if (!timestamps.length) ipConnections.delete(ip)
  }
  for (const [ip, timestamps] of udpDatagrams) {
    pruneTimestamps(timestamps, IP_WINDOW_MS, now)
    if (!timestamps.length) udpDatagrams.delete(ip)
  }
  for (const [key, timestamps] of apiKeyPayloads) {
    pruneTimestamps(timestamps, PAYLOAD_WINDOW_MS, now)
    if (!timestamps.length) apiKeyPayloads.delete(key)
  }
}

function startRateLimitCleanup() {
  const id = setInterval(sweepRateLimitMaps, CLEANUP_INTERVAL_MS)
  if (typeof id.unref === 'function') id.unref()
  return id
}

/** Test helper — clear all trackers. */
function resetRateLimits() {
  ipConnections.clear()
  udpDatagrams.clear()
  apiKeyPayloads.clear()
}

module.exports = {
  checkIpConnection,
  checkUdpDatagram,
  checkPayloadRateLimit,
  startRateLimitCleanup,
  resetRateLimits,
  normalizeIp,
  RATE_LIMIT_DOWNLINK_HEX,
  IP_CONN_LIMIT,
  UDP_IP_DATAGRAM_LIMIT,
  PAYLOAD_LIMIT,
}
