const https = require('node:https')
const { publicLookup, validateWebhookUrl } = require('../safeWebhook')
const { fail } = require('./config')
// No redirects, a single pinned DNS resolution, bounded responses, no ambient proxy.
function request(
  url,
  {
    method = 'POST',
    headers = {},
    body = '',
    signal = AbortSignal.timeout(8000),
  } = {},
) {
  validateWebhookUrl(url)
  if (Buffer.byteLength(body) > 1048576) fail('Request exceeds size limit')
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        headers: { ...headers, 'content-length': Buffer.byteLength(body) },
        signal,
        lookup: publicLookup,
        agent: false,
        maxHeaderSize: 16384,
      },
      (res) => {
        const chunks = []
        let size = 0
        res.on('data', (chunk) => {
          size += chunk.length
          if (size > 65536)
            res.destroy(
              Object.assign(new Error('Provider response exceeds limit'), {
                code: 'INTEGRATION_CONFIG',
              }),
            )
          else chunks.push(chunk)
        })
        res.on('error', reject)
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}
function parse(response) {
  try {
    return JSON.parse(response.body)
  } catch {
    fail('Invalid provider acknowledgment')
  }
}
module.exports = { request, parse }
