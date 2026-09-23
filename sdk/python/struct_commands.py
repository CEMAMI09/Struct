"""Authenticated STRC commands. Application supplies command TCP framing and I/O."""
import hashlib
import hmac
import struct
import time
from struct_persistent import PersistentQueue


def verify_command(frame, key_id, secret, now=None):
    now = int(time.time()) if now is None else now
    if (not isinstance(frame, bytes) or not 77 <= len(frame) <= 1400 or frame[:4] != b'STRC'
            or frame[4:20] != key_id.encode('ascii')
            or not hmac.compare_digest(frame[-32:], hmac.digest(secret.encode('ascii'), frame[:-32], hashlib.sha256))):
        raise ValueError('Invalid command authentication')
    issued, expires = struct.unpack_from('<II', frame, 36)
    if issued > now + 60 or expires <= issued:
        raise ValueError('Invalid command clock')
    return {'id': frame[20:36].hex(), 'expires': expires, 'expired': expires <= now, 'payload': frame[44:-32], 'fingerprint': frame[-32:].hex()}


class CommandReceiver:
    def __init__(self, file, key_id, secret, capacity=32):
        self.key_id, self.secret = key_id, secret
        self.store = PersistentQueue(file, key_id, capacity, kind='commands')

    def handle(self, frame, execute, ack=lambda frame: None, now=None):
        now = int(time.time()) if now is None else now
        with self.store.owned():
            cmd = verify_command(frame, self.key_id, self.secret, now)

            def respond(status):
                code = {'received': 16, 'executed': 17, 'rejected': 18, 'expired': 19, 'unknown': 20}[status]
                body = b'\x02' + self.key_id.encode('ascii') + b'\0' + bytes.fromhex(cmd['id']) + bytes([code])
                ack(body + hmac.digest(self.secret.encode('ascii'), body, hashlib.sha256))
                return status

            if cmd['expired']:
                return respond('expired')
            previous = next((r for r in self.store.records if r['id'] == cmd['id']), None)
            if previous:
                if previous['fingerprint'] != cmd['fingerprint']:
                    raise ValueError('Command ID conflict')
                return respond('unknown' if previous['status'] == 'received' else previous['status'])
            retained = [r for r in self.store.records if r['expires'] > now]
            if len(retained) >= self.store.capacity:
                raise RuntimeError('Command journal full')
            record = {k: cmd[k] for k in ('id', 'expires', 'fingerprint')}
            self.store._commit(retained + [{**record, 'status': 'received'}])
            respond('received')
            try:
                result = execute(cmd)
                status = result if result in ('executed', 'rejected') else 'unknown'
            except Exception:
                status = 'unknown'
            try:
                self.store._commit(retained + [{**record, 'status': status}])
            except OSError:
                return respond('unknown')
            return respond(status)

    def close(self):
        self.store.close()
