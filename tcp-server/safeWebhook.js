const https = require('node:https')
const dns = require('node:dns')
const net = require('node:net')
const ipaddr = require('ipaddr.js')

function isPublicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast' } catch { return false }
}
function validateWebhookUrl(input) {
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Webhook requires HTTPS without URL credentials')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host) && !isPublicAddress(host)) throw new Error('Webhook cannot target a private or reserved IP')
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('Webhook cannot target localhost')
  return url
}
// Validate every DNS answer and connect to that exact resolved address. A second
// resolver lookup or an automatically followed redirect would reopen SSRF.
function publicLookup(host, options, callback) {
  dns.lookup(host, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error)
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) {
      return callback(new Error('Webhook DNS resolved to a private or reserved IP'))
    }
    if (options.all) callback(null, addresses)
    else callback(null, addresses[0].address, addresses[0].family)
  })
}
function postWebhook(input, body, headers, signal) {
  const url = validateWebhookUrl(input)
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', signal, lookup: publicLookup,
      agent: false, headers: { ...headers, 'content-length': Buffer.byteLength(body) } }, res => {
      const status = res.statusCode || 0
      // Only the status matters; never keep an unbounded response body alive.
      res.destroy()
      resolve({ ok: status >= 200 && status < 300, status })
    })
    req.on('error', reject)
    req.end(body)
  })
}
module.exports = { isPublicAddress, validateWebhookUrl, publicLookup, postWebhook }
