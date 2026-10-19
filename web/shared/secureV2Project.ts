import {attachManagementProject,type ManagementProjectOptions} from './managementProject'
import type { PackedField } from './secureV2Schema'
import { generateV2PacketHeader, type SecureV2Slot } from './secureV2Schema'
export interface SecureV2Endpoint {
  host: string
  port: number
  bootstrapOrigin: string
}
function validateEndpoint(endpoint?: SecureV2Endpoint) {
  if (!endpoint) return
  const u = new URL(endpoint.bootstrapOrigin)
  if (
    !/^[a-zA-Z0-9.-]{1,253}$/.test(endpoint.host) ||
    !Number.isInteger(endpoint.port) ||
    endpoint.port < 1 ||
    endpoint.port > 65535 ||
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.pathname !== '/' ||
    u.search ||
    u.hash
  )
    throw new Error('Invalid authenticated ingestion endpoint')
}
export type SecureV2Board = 'esp32-c3-devkitm-1' | 'esp32dev'
export interface SecureV2ProjectCredentials {
  wireDeviceId: number
  rootSecret: string
  bootstrapToken: string
}
export const SECURE_V2_BOARDS: SecureV2Board[] = [
  'esp32-c3-devkitm-1',
  'esp32dev',
]
function cExample(slot: SecureV2Slot): string {
  return slot.schema_definition
    .map((f) => {
      if (f.type === 'string' || f.type === 'bytes')
        return `  packet.f_${f.name}.length = 0; // Fill .data and set UTF-8/raw byte length, max ${f.maxBytes}`
      if (f.type === 'char')
        return `  memcpy(packet.f_${f.name}, "${'A'.repeat(Math.min(f.length, 4))}", ${Math.min(f.length, 4)});`
      if (f.type === 'fixed')
        return `  packet.f_${f.name} = ${f.min}; // Range ${f.min}..${f.max}, step ${f.precision}`
      if (f.type === 'enum')
        return `  packet.f_${f.name} = 0; // First configured enum value`
      return `  packet.f_${f.name} = ${f.type === 'boolean' ? 'true' : ['int', 'uint', 'bitset'].includes(f.type) && 'min' in f && f.min !== undefined ? f.min : 0};`
    })
    .join('\n')
}
/** Sensitive explicit export. Callers must never cache it or log its return value. */
export function generateSecureV2Project(input: {
  slot: SecureV2Slot
  credentials: SecureV2ProjectCredentials
  board: SecureV2Board
  confirmed?: boolean
  management?: ManagementProjectOptions
  endpoint?: SecureV2Endpoint
}): Record<string, string> {
  const { slot, credentials, board } = input
  validateEndpoint(input.endpoint)
  if (!SECURE_V2_BOARDS.includes(board))
    throw new Error('Unsupported ESP32 board')
  if (
    !Number.isInteger(credentials.wireDeviceId) ||
    credentials.wireDeviceId < 1 ||
    credentials.wireDeviceId > 4294967295 ||
    !/^[0-9a-f]{64}$/i.test(credentials.rootSecret) ||
    !/^[0-9a-f]{64}$/i.test(credentials.bootstrapToken)
  )
    throw new Error('Invalid Secure V2 project credentials')
  const confirmed = input.confirmed === true
  const endpointConfig = input.endpoint
    ? `#define STRUCT_CONFIG_INGEST_HOST ${JSON.stringify(input.endpoint.host)}\n#define STRUCT_CONFIG_UDP_PORT ${input.endpoint.port}u\n#define STRUCT_CONFIG_BOOTSTRAP_URL ${JSON.stringify(input.endpoint.bootstrapOrigin + '/api/secure-v2/bootstrap')}\n`
    : ''
  const beginExtra = input.endpoint
    ? ', STRUCT_CONFIG_INGEST_HOST, STRUCT_CONFIG_UDP_PORT, STRUCT_V2_DEFAULT_MAX_FRAME, STRUCT_V2_DEFAULT_RESERVATION, STRUCT_CONFIG_BOOTSTRAP_URL'
    : ''
  const project = {
    'include/struct_config.h': `#ifndef STRUCT_CUSTOMER_CONFIG_H\n#define STRUCT_CUSTOMER_CONFIG_H\n// PRIVATE: never commit this file. Only Wi-Fi credentials need editing.\n#define WIFI_SSID "YOUR_WIFI"\n#define WIFI_PASSWORD "YOUR_PASSWORD"\n#define STRUCT_DEVICE_ID ${credentials.wireDeviceId}u\n#define STRUCT_DEVICE_SECRET "${credentials.rootSecret}"\n#define STRUCT_BOOTSTRAP_TOKEN "${credentials.bootstrapToken}"\n#define STRUCT_CONFIRMED ${confirmed ? 1 : 0}\n${endpointConfig}#endif\n`,
    'include/struct_packet.h': generateV2PacketHeader(slot),
    'src/main.cpp': `#include <Arduino.h>\n#include <WiFi.h>\n#include <time.h>\n#include <StructSecureV2Esp32.h>\n#include "struct_config.h"\n#include "struct_packet.h"\n\nStructSecureV2Esp32 client;\nbool ready = false, waiting = false;\nuint32_t nextSample = 0;\n\nvoid setup() {\n  Serial.begin(115200);\n  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);\n  uint32_t started = millis();\n  while (WiFi.status() != WL_CONNECTED && millis() - started < 30000) delay(100);\n  if (WiFi.status() != WL_CONNECTED) { Serial.println("Wi-Fi unavailable; check struct_config.h"); return; }\n  // First provisioning uses authenticated HTTPS; synchronize certificate-validation time.\n  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");\n  started = millis();\n  while (time(nullptr) < 1700000000 && millis() - started < 10000) delay(100);\n  ready = client.begin(STRUCT_DEVICE_ID, STRUCT_DEVICE_SECRET, STRUCT_BOOTSTRAP_TOKEN${beginExtra});\n  if (!ready) Serial.println("Struct initialization failed. Check network and provisioning; never erase counter state to retry.");\n}\n\nvoid loop() {\n  if (!ready) { delay(1000); return; }\n  if (waiting) {\n    struct_result result = client.poll();\n    if (result != STRUCT_PENDING) { Serial.printf("Struct delivery: %d\\n", (int)result); if(result==STRUCT_COMMITTED) Serial.println("Stored by Struct; open dashboard telemetry."); else if(result==STRUCT_UNKNOWN) Serial.println("Delivery unknown; check diagnostics and preserve counter state."); waiting = false; nextSample = millis() + 60000; }\n  } else if ((int32_t)(millis() - nextSample) >= 0) {\n    StructPacket packet = {};\n    // Replace these example assignments with sensor readings.\n${cExample(slot)}\n    uint8_t encoded[STRUCT_PACKET_SIZE];\n    size_t length = struct_pack_packet(encoded, sizeof(encoded), &packet);\n    if (!length) { Serial.println("Telemetry is outside its schema range"); nextSample = millis() + 60000; }\n    else {\n      struct_result result = client.send(STRUCT_SCHEMA_SLOT, encoded, length, struct_delivery_default(STRUCT_CONFIRMED));\n      waiting = result == STRUCT_PENDING;\n      if (!waiting) { Serial.printf("Struct delivery: %d\\n", (int)result); if(result==STRUCT_COMMITTED) Serial.println("Stored by Struct; open dashboard telemetry."); else if(result==STRUCT_UNKNOWN) Serial.println("Delivery unknown; check diagnostics and preserve counter state."); nextSample = millis() + 60000; }\n    }\n  }\n  delay(5);\n}\n`,
    'platformio.ini': `[env:struct]\nplatform = https://github.com/pioarduino/platform-espressif32/releases/download/55.03.312-1/platform-espressif32.zip\nboard = ${board}\nframework = arduino\nmonitor_speed = 115200\n${board === 'esp32-c3-devkitm-1' ? 'build_flags =\n    -DARDUINO_USB_CDC_ON_BOOT=1\n    -DARDUINO_USB_MODE=1\n' : ''}`,
    '.gitignore': 'include/struct_config.h\n.pio/\n.vscode/\n',
    'lib/Struct/library.json':
      JSON.stringify(
        {
          name: 'Struct',
          version: '0.3.0',
          frameworks: ['arduino'],
          platforms: ['espressif32'],
        },
        null,
        2,
      ) + '\n',
    'schema.json': JSON.stringify(slot, null, 2) + '\n',
    'README.md': `# Struct Secure V2 ESP32 starter\n\nBoard: ${board}. Protocol: Struct Secure V2, schema slot ${slot.slot}, encoding ${slot.encoding}. SDK source is pinned in lib/Struct; this project does not depend on a newer dashboard changing the wire format. Payload ${slot.record_bytes} B; secure datagram ${slot.record_bytes + 25} B; IPv4 + UDP estimate ${slot.record_bytes + 53} B. Receipts are ${confirmed ? 'enabled' : 'disabled'} (${confirmed ? '21 B application when committed' : 'routine telemetry sends once'}).\n\n1. Install VS Code and the PlatformIO extension.\n2. Open this entire folder in VS Code. The SDK is already included in lib/Struct.\n3. Enter your Wi-Fi name and password in include/struct_config.h. Your private Struct ID, secret and one-time provisioning token are already configured. Do not share this file or commit it.\n4. Open src/main.cpp and replace the example assignments with sensor readings. Range checks happen in the generated serializer.\n5. Connect your ESP32; confirm the selected board matches your hardware.\n6. Open the PlatformIO terminal. Run \`pio device list\`, then \`pio run\` to build and \`pio run -t upload --upload-port YOUR_PORT\` (for example COM3 or /dev/ttyUSB0). Select the board matching your hardware. Close other serial monitors before uploading; use BOOT if required by your board.\n7. Run \`pio device monitor --baud 115200 --port YOUR_PORT\`. Result 3 means committed storage; 2 means sent only; 4 means delivery unknown. Open /dashboard with this device selected. See /docs/troubleshooting for Wi-Fi, clock, endpoint, credentials, schema, and serial-port problems.\n\nThe SDK connects to ${input.endpoint ? input.endpoint.host + ' on UDP ' + input.endpoint.port : 'ingest.usestruct.com on UDP 8081'} automatically. You do not need to configure infrastructure. Advanced endpoint overrides are supported by client.begin for staging/private gateways. Wi-Fi and authenticated TLS are required on first provisioning.\n\nImportant: each credential belongs to ONE physical device. The one-time bootstrap initializes persistent counter reservation once. Reboots safely skip unused counters. Do not erase NVS, restore old flash backups, or clone this credential into another device. After counter state loss, rotate the credential and download a new project. A timeout in confirmed mode means delivery is unknown; the SDK retries identical bytes. A receipt proves database acceptance, not webhook completion.\n\nRegeneration replaces generated files. Keep your application changes separately or merge src/main.cpp carefully. Never edit SDK internals to change credentials or packet offsets.\n`,
  }
  return input.management?attachManagementProject(project,input.management):project
}
export function embedSecureV2Sdk(
  project: Record<string, Uint8Array>,
  sdk: Record<string, Uint8Array>,
): Record<string, Uint8Array> {
  const result = { ...project }
  let sources = 0
  for (const [name, data] of Object.entries(sdk)) {
    if (
      name.startsWith('struct-sdk/c/src/') &&
      /\.(h|c|cpp|inc|md|json|txt)$/.test(name)
    ) {
      const relative = name.slice('struct-sdk/c/src/'.length)
      if (relative.split('/').some((p) => p === '..' || p === ''))
        throw new Error('Invalid SDK archive path')
      result[`lib/Struct/src/${relative}`] = data
      sources++
    }
  }
  if (
    !sources ||
    !result['lib/Struct/src/StructSecureV2Esp32.h'] ||
    !result['lib/Struct/src/struct_secure_v2.c']
  )
    throw new Error(
      'Secure V2 SDK archive is unavailable. Update the SDK download before exporting.',
    )
  return result
}

export function generateSecureV2NodeProject(input: {
  slot: SecureV2Slot
  credentials: SecureV2ProjectCredentials
  endpoint?: SecureV2Endpoint
}): Record<string, string> {
  const { slot, credentials } = input
  generateSecureV2Project({ ...input, board: 'esp32dev' })
  if (slot.encoding !== 'bitpacked-v1')
    throw new Error(
      'Node starter requires an optimized slot. Publish a new slot without changing existing firmware.',
    )
  const values = Object.fromEntries(
    (slot.schema_definition as PackedField[]).map((f) => [
      f.name,
      f.type === 'boolean'
        ? true
        : f.type === 'string'
          ? ''
          : f.type === 'bytes'
            ? { $bytes: '' }
            : f.type === 'enum'
              ? f.values?.[0]
              : ['uint', 'int', 'bitset'].includes(f.type) &&
                  (f.width ?? 0) > 32
                ? { $integer: String(f.min ?? 0) }
                : 'min' in f
                  ? (f.min ?? 0)
                  : 0,
    ]),
  )
  return {
    'private-config.json': JSON.stringify(
      {
        ...credentials,
        host: input.endpoint?.host || 'ingest.usestruct.com',
        port: input.endpoint?.port || 8081,
        ...(input.endpoint
          ? { bootstrapOrigin: input.endpoint.bootstrapOrigin }
          : {}),
      },
      null,
      2,
    ),
    'schema.json': JSON.stringify(slot, null, 2),
    'sample.json': JSON.stringify(values, null, 2),
    '.gitignore': 'private-config.json\ncounter.json*\n',
    'send.cjs': `'use strict';
const fs=require('node:fs'),path=require('node:path');
const {SecureV2Client}=require('./sdk/secure-v2-client.cjs');
const {PersistentSequenceCounter}=require('./sdk/secure-v2-counter.cjs');
const codec=require('./sdk/bitpacked.cjs');
async function main(){
 const read=n=>JSON.parse(fs.readFileSync(path.join(__dirname,n),'utf8'));
 const config=read('private-config.json'),slot=read('schema.json');
 const values=JSON.parse(fs.readFileSync(path.join(__dirname,'sample.json'),'utf8'),(k,v)=>v&&v.$integer!==undefined?BigInt(v.$integer):v&&v.$bytes!==undefined?Buffer.from(v.$bytes,'hex'):v);
 const payload=Buffer.from(codec.encodePayload(values,slot.schema_definition)),file=path.join(__dirname,'counter.json');
 const counter=fs.existsSync(file)?new PersistentSequenceCounter(file,config):await PersistentSequenceCounter.provision(file,config);
 try{const result=await new SecureV2Client({...config,counter}).send(slot.slot,payload,{confirmed:true});console.log(JSON.stringify({status:result.status,sequence:result.sequence,payload_bytes:result.payload_bytes,frame_bytes:result.frame_bytes}));if(result.status!=='committed'){console.error('Delivery unknown. Check dashboard and /docs/troubleshooting; preserve counter state.');process.exitCode=2}}finally{counter.close()}
}
main().catch(()=>{console.error('Check private-config.json, sample values, network and counter state. Never delete counter state to retry; rotate a lost credential.');process.exitCode=1});
`,
    'README.md':
      '# Secure V2 Node starter\n\nRequires Node.js 22+; no npm dependencies or hardware. Extract this whole directory, run `node --version`, then `node send.cjs`. The computer needs authenticated HTTPS provisioning and the UDP endpoint in private-config.json (managed default ingest.usestruct.com UDP 8081). Edit sample.json values; schema.json defines their types. Wide integers use {"$integer":"decimal"}; bytes use {"$bytes":"hex"}.\n\nExpected output: {"status":"committed",...} after an authenticated storage receipt. A timeout means unknown, not failure. View /dashboard and /dashboard/debugger for this device; see /docs/troubleshooting. A storage receipt does not prove webhook delivery.\n\nKeep private-config.json secret. ONE sender per credential: do not also flash physical firmware with this credential. Preserve counter.json; bootstrap is one-time. After state loss rotate the credential. A crash may leave counter.json.lock: confirm the old process exited before using the SDK explicit recover option. Never delete counter.json or restore an older counter backup.\n',
  }
}
export function embedSecureV2NodeSdk(
  project: Record<string, Uint8Array>,
  sdk: Record<string, Uint8Array>,
) {
  const files = { ...project }
  for (const name of [
    'secure-v2-client.cjs',
    'secure-v2-counter.cjs',
    'secure-v2.cjs',
    'bitpacked.cjs',
  ]) {
    const data = sdk['struct-sdk/js/' + name]
    if (!data) throw new Error('Current Node SDK archive unavailable')
    files['sdk/' + name] = data
  }
  return files
}
