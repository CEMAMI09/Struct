/*
 * Struct — ESP32 reference sketch
 *
 * Mirrors the dummy schema used in the dashboard Schema Builder:
 *   [{"name":"temp","type":"float32"},{"name":"humidity","type":"float32"},{"name":"is_active","type":"boolean"}]
 *
 * Wire format (little-endian, packed):
 *   [16-byte ASCII api_key][float temp][float humidity][uint8 is_active]
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

// ─── Packed payload matching schemas.schema_definition ────────────────────────
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

bool sendPacket(const TelemetryPacket& packet) {
  if (!client.connect(STRUCT_HOST, STRUCT_PORT)) {
    Serial.println("TCP connect failed");
    return false;
  }

  // 1) 16-byte API key (no null terminator on the wire)
  client.write(reinterpret_cast<const uint8_t*>(API_KEY), 16);

  // 2) Packed struct bytes immediately after
  client.write(reinterpret_cast<const uint8_t*>(&packet), sizeof(packet));

  client.flush();
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
    Serial.print(16 + sizeof(packet));
    Serial.println(" bytes");
  }

  delay(2000);
}
