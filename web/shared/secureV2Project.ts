import {generateV2PacketHeader,type SecureV2Slot} from './secureV2Schema'
export type SecureV2Board = 'esp32-c3-devkitm-1'|'esp32dev'
export interface SecureV2ProjectCredentials {wireDeviceId:number,rootSecret:string,bootstrapToken:string}
export const SECURE_V2_BOARDS:SecureV2Board[]=['esp32-c3-devkitm-1','esp32dev']
function cExample(slot:SecureV2Slot):string {
 return slot.schema_definition.map(f=>{
  if(f.type==='char')return `  memcpy(packet.f_${f.name}, "${'A'.repeat(Math.min(f.length,4))}", ${Math.min(f.length,4)});`
  if(f.type==='fixed')return `  packet.f_${f.name} = ${f.min}; // Range ${f.min}..${f.max}, step ${f.precision}`
  if(f.type==='enum')return `  packet.f_${f.name} = 0; // First configured enum value`
  return `  packet.f_${f.name} = ${f.type==='boolean'?'true':['int','uint','bitset'].includes(f.type)&&'min' in f&&f.min!==undefined?f.min:0};`
 }).join('\n')
}
/** Sensitive explicit export. Callers must never cache it or log its return value. */
export function generateSecureV2Project(input:{slot:SecureV2Slot,credentials:SecureV2ProjectCredentials,board:SecureV2Board,confirmed?:boolean}):Record<string,string> {
 const {slot,credentials,board}=input
 if(!SECURE_V2_BOARDS.includes(board))throw new Error('Unsupported ESP32 board')
 if(!Number.isInteger(credentials.wireDeviceId)||credentials.wireDeviceId<1||credentials.wireDeviceId>4294967295||!/^[0-9a-f]{64}$/i.test(credentials.rootSecret)||!/^[0-9a-f]{64}$/i.test(credentials.bootstrapToken))throw new Error('Invalid Secure V2 project credentials')
 const confirmed=input.confirmed===true
 return {
  'include/struct_config.h':`#ifndef STRUCT_CUSTOMER_CONFIG_H\n#define STRUCT_CUSTOMER_CONFIG_H\n// PRIVATE: never commit this file. Only Wi-Fi credentials need editing.\n#define WIFI_SSID "YOUR_WIFI"\n#define WIFI_PASSWORD "YOUR_PASSWORD"\n#define STRUCT_DEVICE_ID ${credentials.wireDeviceId}u\n#define STRUCT_DEVICE_SECRET "${credentials.rootSecret}"\n#define STRUCT_BOOTSTRAP_TOKEN "${credentials.bootstrapToken}"\n#define STRUCT_CONFIRMED ${confirmed?1:0}\n#endif\n`,
  'include/struct_packet.h':generateV2PacketHeader(slot),
  'src/main.cpp':`#include <Arduino.h>\n#include <WiFi.h>\n#include <time.h>\n#include <StructSecureV2Esp32.h>\n#include "struct_config.h"\n#include "struct_packet.h"\n\nStructSecureV2Esp32 client;\nbool ready = false, waiting = false;\nuint32_t nextSample = 0;\n\nvoid setup() {\n  Serial.begin(115200);\n  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);\n  uint32_t started = millis();\n  while (WiFi.status() != WL_CONNECTED && millis() - started < 30000) delay(100);\n  if (WiFi.status() != WL_CONNECTED) { Serial.println("Wi-Fi unavailable; check struct_config.h"); return; }\n  // First provisioning uses authenticated HTTPS; synchronize certificate-validation time.\n  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");\n  started = millis();\n  while (time(nullptr) < 1700000000 && millis() - started < 10000) delay(100);\n  ready = client.begin(STRUCT_DEVICE_ID, STRUCT_DEVICE_SECRET, STRUCT_BOOTSTRAP_TOKEN);\n  if (!ready) Serial.println("Struct initialization failed. Check network and provisioning; never erase counter state to retry.");\n}\n\nvoid loop() {\n  if (!ready) { delay(1000); return; }\n  if (waiting) {\n    struct_result result = client.poll();\n    if (result != STRUCT_PENDING) { Serial.printf("Struct delivery: %d\\n", (int)result); waiting = false; nextSample = millis() + 60000; }\n  } else if ((int32_t)(millis() - nextSample) >= 0) {\n    StructPacket packet = {};\n    // Replace these example assignments with sensor readings.\n${cExample(slot)}\n    uint8_t encoded[STRUCT_PACKET_SIZE];\n    size_t length = struct_pack_packet(encoded, sizeof(encoded), &packet);\n    if (!length) { Serial.println("Telemetry is outside its schema range"); nextSample = millis() + 60000; }\n    else {\n      struct_result result = client.send(STRUCT_SCHEMA_SLOT, encoded, length, struct_delivery_default(STRUCT_CONFIRMED));\n      waiting = result == STRUCT_PENDING;\n      if (!waiting) { Serial.printf("Struct delivery: %d\\n", (int)result); nextSample = millis() + 60000; }\n    }\n  }\n  delay(5);\n}\n`,
  'platformio.ini':`[env:struct]\nplatform = https://github.com/pioarduino/platform-espressif32/releases/download/55.03.312-1/platform-espressif32.zip\nboard = ${board}\nframework = arduino\nmonitor_speed = 115200\n${board==='esp32-c3-devkitm-1'?'build_flags =\n    -DARDUINO_USB_CDC_ON_BOOT=1\n    -DARDUINO_USB_MODE=1\n':''}`,
  '.gitignore':'include/struct_config.h\n.pio/\n.vscode/\n',
  'lib/Struct/library.json':JSON.stringify({name:'Struct',version:'0.3.0',frameworks:['arduino'],platforms:['espressif32']},null,2)+'\n',
  'schema.json':JSON.stringify(slot,null,2)+'\n',
  'README.md':`# Struct Secure V2 ESP32 starter\n\nBoard: ${board}. Protocol: Struct Secure V2, schema slot ${slot.slot}, encoding ${slot.encoding}. SDK source is pinned in lib/Struct; this project does not depend on a newer dashboard changing the wire format. Payload ${slot.record_bytes} B; secure datagram ${slot.record_bytes+25} B; IPv4 + UDP estimate ${slot.record_bytes+53} B. Receipts are ${confirmed?'enabled':'disabled'} (${confirmed?'21 B application when committed':'routine telemetry sends once'}).\n\n1. Install VS Code and the PlatformIO extension.\n2. Open this entire folder in VS Code. The SDK is already included in lib/Struct.\n3. Enter your Wi-Fi name and password in include/struct_config.h. Your private Struct ID, secret and one-time provisioning token are already configured. Do not share this file or commit it.\n4. Open src/main.cpp and replace the example assignments with sensor readings. Range checks happen in the generated serializer.\n5. Connect your ESP32; confirm the selected board matches your hardware.\n6. Run pio run to build, then pio run -t upload.\n7. Run pio device monitor and open the Struct dashboard to see telemetry.\n\nThe SDK connects to ingest.usestruct.com on UDP 8081 automatically. You do not need to configure infrastructure. Advanced endpoint overrides are supported by client.begin for staging/private gateways. Wi-Fi and authenticated TLS are required on first provisioning.\n\nImportant: each credential belongs to ONE physical device. The one-time bootstrap initializes persistent counter reservation once. Reboots safely skip unused counters. Do not erase NVS, restore old flash backups, or clone this credential into another device. After counter state loss, rotate the credential and download a new project. A timeout in confirmed mode means delivery is unknown; the SDK retries identical bytes. A receipt proves database acceptance, not webhook completion.\n\nRegeneration replaces generated files. Keep your application changes separately or merge src/main.cpp carefully. Never edit SDK internals to change credentials or packet offsets.\n`,
 }
}
export function embedSecureV2Sdk(project:Record<string,Uint8Array>,sdk:Record<string,Uint8Array>):Record<string,Uint8Array> {
 const result={...project};let sources=0
 for(const [name,data] of Object.entries(sdk)){
  if(name.startsWith('struct-sdk/c/src/')&&/\.(h|c|cpp|inc|md|json|txt)$/.test(name)){
   const relative=name.slice('struct-sdk/c/src/'.length)
   if(relative.split('/').some(p=>p==='..'||p===''))throw new Error('Invalid SDK archive path')
   result[`lib/Struct/src/${relative}`]=data;sources++
  }
 }
 if(!sources||!result['lib/Struct/src/StructSecureV2Esp32.h']||!result['lib/Struct/src/struct_secure_v2.c'])throw new Error('Secure V2 SDK archive is unavailable. Update the SDK download before exporting.')
 return result
}
