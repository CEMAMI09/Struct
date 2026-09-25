"""Struct UDP client. Encryption uses the optional cryptography dependency."""
import hashlib
import hmac
import ipaddress
import secrets
import socket
import struct
import time
import threading


def build_frame(key_id, api_secret, schema_version, payload, *, confirmed=False,
                timestamp_sec=None, nonce=None, encryption_key=None, event_id=None):
    if not isinstance(key_id, str) or len(key_id) != 16 or any(not 33 <= ord(c) <= 126 for c in key_id):
        raise ValueError('key_id must be 16 ASCII characters')
    if not isinstance(api_secret, str) or len(api_secret) != 64 or any(c not in '0123456789abcdefABCDEF' for c in api_secret):
        raise ValueError('api_secret must be 64 hex characters, used as ASCII')
    if type(schema_version) is not int or not 1 <= schema_version <= 255:
        raise ValueError('schema_version must be 1..255')
    if not isinstance(payload, bytes) or not 1 <= len(payload) <= 1334:
        raise ValueError('payload must be 1..1334 bytes')
    if type(confirmed) is not bool:
        raise ValueError('confirmed must be boolean')
    timestamp_sec = int(time.time()) if timestamp_sec is None else timestamp_sec
    if type(timestamp_sec) is not int or not 0 <= timestamp_sec <= 0xffffffff:
        raise ValueError('timestamp_sec must be uint32')
    nonce = secrets.token_bytes(12) if nonce is None else nonce
    if not isinstance(nonce, bytes) or len(nonce) != 12:
        raise ValueError('nonce must be 12 bytes')
    if event_id is not None:
        if not confirmed or not isinstance(event_id, bytes) or len(event_id) != 16:
            raise ValueError('event_id needs confirmed mode and 16 bytes')
        payload = event_id + payload
    if encryption_key is not None:
        if not isinstance(encryption_key, str) or len(encryption_key) != 64 or any(c not in '0123456789abcdefABCDEF' for c in encryption_key):
            raise ValueError('encryption_key must be 64 hex characters')
        from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
        enc_nonce = secrets.token_bytes(12)
        payload = enc_nonce + ChaCha20Poly1305(bytes.fromhex(encryption_key)).encrypt(enc_nonce, struct.pack('<I', timestamp_sec) + payload, None)
    if len(payload) > 1334:
        raise ValueError('Frame exceeds 1400 bytes')
    body = struct.pack('<B16sBI12s', 4 if event_id is not None else 3 if confirmed else 2, key_id.encode('ascii'),
                       schema_version, timestamp_sec, nonce) + payload
    return body + hmac.digest(api_secret.encode('ascii'), body, hashlib.sha256)


def verify_receipt(receipt, frame_mac, api_secret):
    return (len(receipt) == 69 and len(frame_mac) == 32 and receipt[:4] == b'STRA'
            and receipt[36] in (0, 1) and hmac.compare_digest(receipt[4:36], frame_mac)
            and hmac.compare_digest(receipt[37:], hmac.digest(api_secret.encode('ascii'), receipt[:37], hashlib.sha256)))


class StructClient:
    def __init__(self, host, key_id, api_secret, port=8081, encryption_key=None):
        # Numeric IPv4 avoids an unbounded OS DNS lookup inside the awake budget.
        self.host = str(ipaddress.IPv4Address(host))
        if type(port) is not int or not 1 <= port <= 65535:
            raise ValueError('port must be 1..65535')
        self.port, self.key_id, self.api_secret = port, key_id, api_secret
        self.encryption_key = encryption_key
        self._lock = threading.Lock()

    def send(self, schema_version, payload, *, confirmed=False, max_retries=1,
             retry_ms=3000, budget_ms=7500, event_id=None):
        if (type(max_retries) is not int or not 0 <= max_retries <= 3
                or type(retry_ms) is not int or not 1000 <= retry_ms <= 30000
                or type(budget_ms) is not int or not 1 <= budget_ms <= 30000):
            raise ValueError('Invalid delivery budget')
        if not self._lock.acquire(blocking=False):
            raise RuntimeError('A packet is already in flight')
        try:
            return self._send(schema_version, payload, confirmed, max_retries, retry_ms, budget_ms, event_id)
        finally:
            self._lock.release()

    async def async_send(self, *args, **kwargs):
        """Worker-thread send. Cancellation does not revoke an in-flight datagram;
        the bounded worker completes before the client can accept another send."""
        import asyncio
        return await asyncio.to_thread(self.send, *args, **kwargs)

    def _send(self, version, payload, confirmed, max_retries, retry_ms, budget_ms, event_id):
        frame = build_frame(self.key_id, self.api_secret, version, payload, confirmed=confirmed,
                            encryption_key=self.encryption_key, event_id=event_id)
        packet_id = hashlib.sha256(frame).hexdigest()
        started = time.monotonic()
        deadline = started + budget_ms / 1000
        attempts = 0
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect((self.host, self.port))
            while time.monotonic() < deadline:
                attempts += 1
                try:
                    sock.send(frame)
                except OSError:
                    if attempts == 1:
                        raise
                    break
                if not confirmed:
                    return {'status': 'sent', 'attempts': attempts, 'packet_id': packet_id}
                wait = retry_ms / 1000 * 2 ** (attempts - 1) + secrets.randbelow(retry_ms // 4 + 1) / 1000
                next_send = min(deadline, time.monotonic() + wait) if attempts <= max_retries else deadline
                while time.monotonic() < next_send:
                    sock.settimeout(max(0.001, next_send - time.monotonic()))
                    try:
                        receipt = sock.recv(70)
                    except socket.timeout:
                        break
                    except OSError:
                        return {'status': 'unknown', 'attempts': attempts, 'packet_id': packet_id}
                    if verify_receipt(receipt, frame[-32:], self.api_secret):
                        return {'status': 'committed', 'attempts': attempts, 'duplicate': receipt[36] == 1, 'packet_id': packet_id}
                if attempts > max_retries:
                    break
        return {'status': 'unknown', 'attempts': attempts, 'packet_id': packet_id}
