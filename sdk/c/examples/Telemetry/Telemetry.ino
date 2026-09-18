// Install sdk/c as the Struct Arduino library. ESP32 only.
// Schema: temp=float32, humidity=float32, is_active=boolean, version=1.
#include <WiFi.h>
#include <StructEsp32.h>
const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char *KEY_ID = "0123456789abcdef";
const char *API_SECRET = "REPLACE_WITH_THE_64_CHARACTER_API_SECRET_FROM_DEVICE_CREATION";
StructEsp32 telemetry;
bool waiting = false;
uint32_t nextSample = 0;
void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 15000) delay(50);
  if (WiFi.status() != WL_CONNECTED) { Serial.println("WiFi unavailable"); return; }
  configTime(0, 0, "pool.ntp.org");
  started = millis();
  while (time(nullptr) < 1577836800 && millis() - started < 10000) delay(50);
  if (!telemetry.begin(IPAddress(192, 168, 1, 100), 8081, KEY_ID, API_SECRET)) {
    Serial.println("Check Struct credentials and UDP socket");
  }
}
void loop() {
  if (waiting) {
    const struct_result result = telemetry.poll();
    if (result != STRUCT_PENDING) {
      waiting = false;
      Serial.println(result == STRUCT_COMMITTED ? "Stored by Struct" : "Delivery unknown");
      // Safe point to close the socket and sleep. For deep sleep, call
      // telemetry.end(), then configure the board's desired wake timer.
      nextSample = millis() + 60000;
    }
  } else if ((int32_t)(millis() - nextSample) >= 0) {
    uint8_t payload[9];
    struct_put_f32(payload, 23.5f); struct_put_f32(payload + 4, 61.25f); payload[8] = 1;
    // 0: send once, no receipt traffic. 1: opt into a signed storage receipt.
    // Confirmed defaults: one retry and a 7.5-second maximum wait budget.
    const struct_result result = telemetry.send(1, payload, sizeof(payload), struct_delivery_default(1));
    waiting = result == STRUCT_PENDING;
    if (!waiting) {
      Serial.println(result == STRUCT_SENT ? "Sent (unconfirmed)" : "Send failed");
      nextSample = millis() + 60000;
    }
  }
  delay(5);
}
