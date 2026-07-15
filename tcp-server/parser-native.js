/**
 * Native (napi-rs) parser with JavaScript fallback.
 *
 * Loads ./native-parser when built; otherwise uses parser.js.
 */
const jsParser = require('./parser')

let native = null
let source = 'js'

try {
  // Optional native binding produced by napi-rs under native-parser/
  // eslint-disable-next-line import/no-unresolved
  native = require('./native-parser')
  if (
    native &&
    typeof native.schemaByteLength === 'function' &&
    typeof native.parsePayload === 'function'
  ) {
    source = 'native'
  } else {
    native = null
  }
} catch {
  native = null
}

if (source === 'js') {
  console.warn('[struct] native parser unavailable — using JavaScript parser fallback')
}

function schemaByteLength(schemaDefinition) {
  if (native) {
    try {
      return native.schemaByteLength(
        typeof schemaDefinition === 'string'
          ? schemaDefinition
          : JSON.stringify(schemaDefinition),
      )
    } catch (err) {
      console.warn(`[struct] native schemaByteLength failed: ${err.message}`)
    }
  }
  return jsParser.schemaByteLength(schemaDefinition)
}

function parsePayload(buf, schemaDefinition) {
  if (native) {
    try {
      const schemaJson =
        typeof schemaDefinition === 'string'
          ? schemaDefinition
          : JSON.stringify(schemaDefinition)
      const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
      return native.parsePayload(buffer, schemaJson)
    } catch (err) {
      console.warn(`[struct] native parsePayload failed: ${err.message}`)
    }
  }
  return jsParser.parsePayload(buf, schemaDefinition)
}

function encodePayload(values, schemaDefinition) {
  if (native && typeof native.encodePayload === 'function') {
    try {
      return Buffer.from(
        native.encodePayload(
          typeof values === 'string' ? values : JSON.stringify(values),
          typeof schemaDefinition === 'string'
            ? schemaDefinition
            : JSON.stringify(schemaDefinition),
        ),
      )
    } catch (err) {
      console.warn(`[struct] native encodePayload failed: ${err.message}`)
    }
  }
  return jsParser.encodePayload(values, schemaDefinition)
}

module.exports = {
  TYPE_SIZES: jsParser.TYPE_SIZES,
  schemaByteLength,
  parsePayload,
  encodePayload,
  normalizeType: jsParser.normalizeType,
  fieldByteLength: jsParser.fieldByteLength,
  validateFlagsField: jsParser.validateFlagsField,
  parserSource: source,
  hasNative: source === 'native',
}
