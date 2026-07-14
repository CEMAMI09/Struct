/*
 * Struct — ESP32 reference sketch
 *
 * Mirrors a typical dashboard schema:
 *   [{"name":"temp","type":"float32"},{"name":"humidity","type":"float32"},{"name":"is_active","type":"boolean"}]
 *
 * Wire format (little-endian, packed):
 *   [16-byte ASCII api_key][1-byte SCHEMA_VERSION][float temp][float humidity][uint8 is_active]
 *
 * Optional ChaCha20-Poly1305 (enable in Schema Builder):
 *   [16-byte api_key][1-byte version][12-byte nonce][ciphertext][16-byte tag]
 *   Ciphertext plaintext = [uint32 LE unix timestamp][packed struct]
 *   Paste the 64-char hex key from the dashboard into ENCRYPTION_KEY_HEX below
 *   and set ENCRYPTION_ENABLED to true (requires a ChaCha20-Poly1305 lib such as
 *   Arduino Cryptography / mbedtls — left as a hook; keep false for plaintext).
 *
 * Prefer "Download C++ Header" on /dashboard/schema for the exact packed layout.
 *
 * Downlink (after uplink, same TCP session):
 *   [uint16 LE length][cmd…]
 *   0x01 + uint32 sec  → set wake interval
 *   0x02               → reboot
 *   0xFF + bytes       → custom
 *
 * Flash with Arduino IDE / PlatformIO (board: ESP32). Update WiFi + server IP
 * and paste your device api_key from the Struct Devices page.
 */

#include <WiFi.h>
#include <WiFiClient.h>
#include <stdint.h>
#include <string.h>

// ─── Config ───────────────────────────────────────────────────────────────────
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

const char* STRUCT_HOST   = "192.168.1.100";  // machine running tcp-server
const uint16_t STRUCT_PORT = 8080;

// Must be exactly 16 characters — copy from Struct dashboard
const char API_KEY[16] = {
  'a','b','c','d','e','f','0','1','2','3','4','5','6','7','8','9'
};

// Must match schemas.version / Download C++ Header (STRUCT_SCHEMA_VERSION)
const uint8_t SCHEMA_VERSION = 1;

// Set true only after you wire in a ChaCha20-Poly1305 encrypt helper
const bool ENCRYPTION_ENABLED = false;
// const char* ENCRYPTION_KEY_HEX = "…64 hex chars from Schema Builder…";

uint32_t wakeIntervalMs = 2000;

// ─── Packed payload matching schema_versions.schema_definition ────────────────
#pragma pack(push, 1)
struct TelemetryPacket {
  float   temp;       // float32
  float   humidity;   // float32
  uint8_t is_active;  // boolean (0 / 1)
};
#pragma pack(pop)

static_assert(sizeof(TelemetryPacket) == 9, "Unexpected packed size");

WiFiClient client;

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("IP ");
  Serial.println(WiFi.localIP());
}

void handleDownlink() {
  while (client.available() >= 2) {
    uint8_t hdr[2];
    if (client.readBytes(hdr, 2) != 2) break;
    uint16_t len = (uint16_t)hdr[0] | ((uint16_t)hdr[1] << 8);
    if (len == 0 || len > 256) break;

    uint8_t buf[256];
    size_t got = client.readBytes(buf, len);
    if (got != len || len < 1) break;

    uint8_t cmd = buf[0];
    if (cmd == 0x01 && len >= 5) {
      uint32_t secs =
        (uint32_t)buf[1] |
        ((uint32_t)buf[2] << 8) |
        ((uint32_t)buf[3] << 16) |
        ((uint32_t)buf[4] << 24);
      wakeIntervalMs = secs * 1000UL;
      Serial.print("Downlink set_interval → ");
      Serial.print(secs);
      Serial.println("s");
    } else if (cmd == 0x02) {
      Serial.println("Downlink reboot");
      delay(100);
      ESP.restart();
    } else {
      Serial.print("Downlink custom ");
      Serial.print(len);
      Serial.println("B");
    }
  }
}

bool sendPacket(const TelemetryPacket& packet) {
  if (!client.connect(STRUCT_HOST, STRUCT_PORT)) {
    Serial.println("TCP connect failed");
    return false;
  }

  // 1) 16-byte API key (no null terminator on the wire)
  client.write(reinterpret_cast<const uint8_t*>(API_KEY), 16);

  // 2) Schema version byte — gateway routes to the matching immutable layout
  client.write(&SCHEMA_VERSION, 1);

  // 3) Packed struct bytes (plaintext). When ENCRYPTION_ENABLED, wrap with
  //    ChaCha20-Poly1305 over [uint32 LE unix_ts][packed struct]:
  //    nonce(12) + ciphertext + tag(16) instead.
  (void)ENCRYPTION_ENABLED;
  client.write(reinterpret_cast<const uint8_t*>(&packet), sizeof(packet));

  client.flush();

  unsigned long start = millis();
  while (millis() - start < 400) {
    if (client.available()) handleDownlink();
    delay(10);
  }

  client.stop();
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  connectWiFi();
}

void loop() {
  TelemetryPacket packet;
  packet.temp = 22.5f + (float)(millis() % 1000) / 100.0f;
  packet.humidity = 40.0f + (float)(millis() % 500) / 50.0f;
  packet.is_active = 1;

  if (sendPacket(packet)) {
    Serial.print("Sent ");
    Serial.print(16 + 1 + sizeof(packet));
    Serial.print(" bytes (schema v");
    Serial.print(SCHEMA_VERSION);
    Serial.println(")");
  }

  delay(wakeIntervalMs);
}
