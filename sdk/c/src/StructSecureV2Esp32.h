#ifndef STRUCT_SECURE_V2_ESP32_H
#define STRUCT_SECURE_V2_ESP32_H
#include <WiFi.h>
#include <WiFiUdp.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <nvs.h>
#include <time.h>
#include "struct_secure_v2.h"
#include "struct_v2_counter.h"
#include "struct_v2_mbedtls.h"
#include "struct_v2_tls_root.h"

#define STRUCT_V2_DEFAULT_BOOTSTRAP_URL "https://www.usestruct.com/api/secure-v2/bootstrap"

/* One owner task/credential; no ISR or concurrent instances for the same root.
 * Ordinary begin never resets missing NVS. Only a consumed-once authenticated
 * bootstrap grant can initialize it. Keep NVS through firmware updates; flash
 * erase/rollback/cloning requires a fresh root and wire ID. Bootstrap is a
 * bounded blocking first-run operation. send/poll are nonblocking UDP operations.
 * Wi-Fi and a valid Unix clock for HTTPS validation are application-owned. */
class StructSecureV2Esp32 {
  WiFiUDP udp;
  IPAddress host;
  uint16_t destinationPort = STRUCT_DEFAULT_UDP_PORT;
  struct_v2_client client{};
  struct_v2_counter_port counter{};
  nvs_handle_t nvsHandle = 0;
  bool nvsOpened = false, ready = false, freshBootstrap = false;

  class BoundedResponse : public Stream {
  public:
    char data[128]{};
    size_t length = 0;
    size_t write(uint8_t byte) override { return write(&byte, 1); }
    size_t write(const uint8_t *bytes, size_t n) override {
      if (n > sizeof(data) - 1 - length) return 0;
      memcpy(data + length, bytes, n); length += n; data[length] = 0; return n;
    }
    int available() override { return 0; }
    int read() override { return -1; }
    int peek() override { return -1; }
    void flush() override {}
  };
  static void whitespace(const char *&p) { while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') ++p; }
  static bool initialGrant(const char *p) {
    /* This exact endpoint grants only zero for a never-used credential. No
     * permissive numeric conversion, missing-field fallback, or inferred range. */
    whitespace(p); if (*p++ != '{') return false; whitespace(p);
    const char key[] = "\"nextSequence\"";
    if (strncmp(p, key, sizeof(key) - 1)) return false; p += sizeof(key) - 1;
    whitespace(p); if (*p++ != ':') return false; whitespace(p);
    if (*p++ != '0') return false; whitespace(p); if (*p++ != '}') return false;
    whitespace(p); return !*p;
  }
  static bool validToken(const char *token) {
    if (!token || strlen(token) != 64) return false;
    for (size_t i = 0; i < 64; ++i) if (!((token[i] >= '0' && token[i] <= '9') ||
      (token[i] >= 'a' && token[i] <= 'f') || (token[i] >= 'A' && token[i] <= 'F'))) return false;
    return true;
  }
  static int readCounter(void *u, uint8_t *out, size_t capacity) {
    auto *self = static_cast<StructSecureV2Esp32 *>(u); size_t n = capacity;
    if (!self->nvsOpened) return -1;
    esp_err_t result = nvs_get_blob(self->nvsHandle, "counter", out, &n);
    if (result == ESP_ERR_NVS_NOT_FOUND) return 0;
    return result == ESP_OK && n <= capacity ? (int)n : -1;
  }
  static int writeCounter(void *u, const uint8_t *bytes, size_t n) {
    auto *self = static_cast<StructSecureV2Esp32 *>(u);
    if (!self->nvsOpened || n != STRUCT_V2_COUNTER_RECORD_SIZE) return -1;
    if (nvs_set_blob(self->nvsHandle, "counter", bytes, n) != ESP_OK) return -1;
    return nvs_commit(self->nvsHandle) == ESP_OK ? 0 : -1;
  }
  static int reserveCounter(void *u, uint32_t wireId, const uint8_t fingerprint[32],
      uint32_t block, uint64_t *first, uint64_t *end) {
    auto *self = static_cast<StructSecureV2Esp32 *>(u);
    return struct_v2_counter_reserve(&self->counter, wireId, fingerprint, block, first, end);
  }
  static int sendBytes(void *u, const uint8_t *bytes, size_t n) {
    auto *self = static_cast<StructSecureV2Esp32 *>(u);
    if (!self->udp.beginPacket(self->host, self->destinationPort)) return -1;
    if (self->udp.write(bytes, n) != n) return -1;
    return self->udp.endPacket() == 1 ? 0 : -1;
  }
  static int receiveBytes(void *u, uint8_t *out, size_t capacity) {
    auto *self = static_cast<StructSecureV2Esp32 *>(u); int n = self->udp.parsePacket();
    if (!n) return 0;
    if (self->udp.remoteIP() != self->host || self->udp.remotePort() != self->destinationPort || n > (int)capacity) {
      while (self->udp.available()) self->udp.read(); return 0;
    }
    return self->udp.read(out, capacity);
  }
  bool bootstrap(uint32_t wireId, const char *token, const char *url, const char *ca) {
    if (!validToken(token) || !url || strncmp(url, "https://", 8) || !ca || !*ca || time(nullptr) < 1700000000) return false;
    WiFiClientSecure tls; HTTPClient http; BoundedResponse response;
    tls.setCACert(ca); tls.setHandshakeTimeout(15); http.setConnectTimeout(10000); http.setTimeout(15000);
    http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
    if (!http.begin(tls, url)) return false;
    http.addHeader("Content-Type", "application/json");
    String body = String("{\"wireDeviceId\":") + String(wireId) + ",\"bootstrapToken\":\"" + token + "\"}";
    int status = http.POST(body);
    /* Never retry automatically: an unknown HTTP outcome may have consumed the
     * token. A new credential is the safe recovery from absent durable state. */
    int received = status == 200 ? http.writeToStream(&response) : -1;
    http.end(); tls.stop(); body = "";
    return status == 200 && received > 0 && received == (int)response.length && initialGrant(response.data);
  }
public:
  StructSecureV2Esp32() = default;
  StructSecureV2Esp32(const StructSecureV2Esp32 &) = delete;
  StructSecureV2Esp32 &operator=(const StructSecureV2Esp32 &) = delete;
  ~StructSecureV2Esp32() { end(); }

  bool begin(uint32_t wireId, const char *rootHex, const char *bootstrapToken,
      const char *hostname = STRUCT_DEFAULT_INGEST_HOST, uint16_t port = STRUCT_DEFAULT_UDP_PORT,
      size_t maxFrame = STRUCT_V2_DEFAULT_MAX_FRAME, uint32_t block = STRUCT_V2_DEFAULT_RESERVATION,
      const char *bootstrapUrl = STRUCT_V2_DEFAULT_BOOTSTRAP_URL, const char *trustedCa = STRUCT_V2_TLS_ROOT) {
    end(); freshBootstrap=false; if (!hostname || !*hostname || !port || WiFi.status() != WL_CONNECTED) return false;
    if (WiFi.hostByName(hostname, host) != 1) return false;
    destinationPort = port;
    char name[16]; snprintf(name, sizeof(name), "sv2%08lx", (unsigned long)wireId);
    if (nvs_open(name, NVS_READWRITE, &nvsHandle) != ESP_OK) return false; nvsOpened = true;
    counter.user = this; counter.read = readCounter; counter.write = writeCounter;
    struct_v2_port callbacks{}; callbacks.user = this;
    callbacks.hkdf = struct_v2_mbedtls_hkdf; callbacks.sha256 = struct_v2_mbedtls_sha256;
    callbacks.seal = struct_v2_mbedtls_seal; callbacks.open = struct_v2_mbedtls_open;
    callbacks.send = sendBytes; callbacks.receive = receiveBytes; callbacks.reserve = reserveCounter;
    if (struct_v2_init_hex(&client, &callbacks, wireId, rootHex, block, maxFrame) != STRUCT_IDLE) { end(); return false; }
    uint64_t next = 0; int state = struct_v2_counter_load(&counter, wireId, client.key_fingerprint, &next);
    if (state == 1) {
      if (!bootstrap(wireId, bootstrapToken, bootstrapUrl, trustedCa) ||
          struct_v2_counter_provision(&counter, wireId, client.key_fingerprint, 0)) { end(); return false; }
      freshBootstrap=true;
    } else if (state != 0 || next == STRUCT_V2_COUNTER_LIMIT) { end(); return false; }
    ready = udp.begin(49152u + (esp_random() % 16384u)) == 1;
    if (!ready) end(); return ready;
  }
  struct_result send(uint8_t slot, const uint8_t *payload, size_t n,
      struct_delivery delivery = struct_delivery_default(0)) {
    return ready ? struct_v2_send(&client, slot, payload, n, millis(), delivery) : STRUCT_INVALID;
  }
  bool freshlyBootstrapped() const { return freshBootstrap && ready; }
  size_t batchCapacity(size_t recordSize) const { return ready ? struct_v2_batch_capacity(&client, recordSize) : 0; }
  struct_result sendBatch(uint8_t slot, const uint8_t *records, size_t recordSize, size_t count,
      size_t *encodedCount, struct_delivery delivery = struct_delivery_default(0)) {
    return ready ? struct_v2_send_batch(&client, slot, records, recordSize, count, encodedCount, millis(), delivery) : STRUCT_INVALID;
  }
  struct_result poll() { return ready ? struct_v2_poll(&client, millis()) : STRUCT_INVALID; }
  void cancel() { struct_v2_cancel(&client); }
  void end() {
    udp.stop(); struct_v2_clear(&client); ready = false;
    if (nvsOpened) nvs_close(nvsHandle); nvsOpened = false; nvsHandle = 0; counter = {};
  }
};
#endif
