#ifndef STRUCT_ESP32_H
#define STRUCT_ESP32_H
#include <WiFiUdp.h>
#include <esp_system.h>
#include <time.h>
#include "struct_sdk.h"
#include "struct_mbedtls.h"

// ESP32 Arduino adapter. WiFi and clock sync are configured by the application.
// One instance owns one UDP socket and one in-flight packet; not thread-safe.
class StructEsp32 {
  WiFiUDP udp;
  IPAddress host;
  uint16_t port = 8081;
  struct_client client{};
  bool ready = false;
  static int randomBytes(void *, uint8_t *out, size_t n) { esp_fill_random(out, n); return 0; }
  static int sendBytes(void *u, const uint8_t *data, size_t n) {
    auto *self = static_cast<StructEsp32 *>(u);
    if (!self->udp.beginPacket(self->host, self->port)) return -1;
    if (self->udp.write(data, n) != n) return -1;
    return self->udp.endPacket() == 1 ? 0 : -1;
  }
  static int receiveBytes(void *u, uint8_t *out, size_t cap) {
    auto *self = static_cast<StructEsp32 *>(u);
    int n = self->udp.parsePacket();
    if (!n) return 0;
    if (self->udp.remoteIP() != self->host || self->udp.remotePort() != self->port || n > (int)cap) {
      while (self->udp.available()) self->udp.read();
      return 0;
    }
    return self->udp.read(out, cap);
  }
public:
  // For durable queue integration; never use ordinary send/poll concurrently.
  struct_client &queueClient() { return client; }
  StructEsp32() = default;
  StructEsp32(const StructEsp32 &) = delete;
  StructEsp32 &operator=(const StructEsp32 &) = delete;
  ~StructEsp32() { end(); }
  bool begin(IPAddress address, uint16_t destination_port, const char *key, const char *secret) {
    end(); host = address; port = destination_port;
    struct_port p{}; p.user = this; p.random = randomBytes; p.hmac = struct_mbedtls_hmac;
    p.send = sendBytes; p.receive = receiveBytes;
#if defined(MBEDTLS_CHACHAPOLY_C)
    p.encrypt = struct_mbedtls_encrypt;
#endif
    if (struct_init(&client, &p, key, secret) != STRUCT_IDLE) return false;
    // Use a random high source port. WiFi must be active for ESP32's hardware RNG.
    ready = udp.begin(49152u + (esp_random() % 16384u)) == 1;
    return ready;
  }
  struct_result encryption(const uint8_t *key_or_null) { return struct_set_encryption(&client, key_or_null); }
  struct_result send(uint8_t version, const uint8_t *payload, size_t n, struct_delivery d = struct_delivery_default(0)) {
    time_t now = time(nullptr);
    if (!ready || now < 1577836800 || (uint64_t)now > UINT32_MAX) return STRUCT_INVALID;
    return struct_send(&client, version, payload, n, (uint32_t)now, millis(), d);
  }
  struct_result poll() { return struct_poll(&client, millis()); }
  void cancel() { struct_cancel(&client); }
  void end() { udp.stop(); struct_clear(&client); ready = false; }
};
#endif
