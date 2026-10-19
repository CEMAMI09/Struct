const crypto = require('node:crypto')
function key() {
  const value = process.env.STRUCT_INTEGRATION_KEY || ''
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error('Integration encryption key unavailable')
  return Buffer.from(value, 'hex')
}
function seal(value, organizationId, destinationId) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(
    Buffer.from(`struct-integration-v1:${organizationId}:${destinationId}`),
  )
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ])
  return [
    'v1',
    iv.toString('hex'),
    data.toString('hex'),
    cipher.getAuthTag().toString('hex'),
  ].join(':')
}
function open(blob, organizationId, destinationId) {
  try {
    const [version, iv, data, tag, extra] = blob.split(':')
    if (
      version !== 'v1' ||
      extra ||
      !/^[a-f0-9]{24}$/.test(iv) ||
      !/^[a-f0-9]{32}$/.test(tag) ||
      !/^[a-f0-9]+$/.test(data)
    )
      throw new Error()
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key(),
      Buffer.from(iv, 'hex'),
    )
    decipher.setAAD(
      Buffer.from(`struct-integration-v1:${organizationId}:${destinationId}`),
    )
    decipher.setAuthTag(Buffer.from(tag, 'hex'))
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(data, 'hex')),
        decipher.final(),
      ]).toString(),
    )
  } catch {
    throw Object.assign(new Error('Integration credentials unavailable'), {
      code: 'INTEGRATION_CONFIG',
    })
  }
}
module.exports = { seal, open }
