"""Single-writer, bounded file queue. Protect plaintext snapshots at rest."""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import secrets
import threading
import time


class PersistentQueue:
    def __init__(self, file, key_id, capacity=32, *, kind='telemetry'):
        if type(capacity) is not int or not 1 <= capacity <= 256 or len(key_id) != 16 or kind not in ('telemetry', 'commands'):
            raise ValueError('Invalid queue configuration')
        self.file, self.key_id, self.capacity, self.kind = Path(file), key_id, capacity, kind
        self.file.parent.mkdir(parents=True, exist_ok=True)
        self.lock_path = self.file.with_name(self.file.name + '.lock')
        self._guard, self.failed, self.closed = threading.Lock(), False, False
        self._fd = os.open(self.lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        try:
            os.write(self._fd, str(os.getpid()).encode())
            self.records = []
            if self.file.exists():
                if self.file.stat().st_size > 1_000_000:
                    raise ValueError('Queue too large')
                wrapper = json.loads(self.file.read_text())
                text = wrapper['snapshot']
                if hashlib.sha256(text.encode()).hexdigest() != wrapper['sha256']:
                    raise ValueError('Queue checksum mismatch')
                data = json.loads(text)
                if data['version'] != 1 or data['key_id'] != key_id or data['kind'] != kind:
                    raise ValueError('Queue identity/format mismatch')
                self.records = data['records']
                if not isinstance(self.records, list) or len(self.records) > capacity:
                    raise ValueError('Queue capacity mismatch')
        except BaseException:
            os.close(self._fd)
            self.lock_path.unlink()
            raise

    @contextlib.contextmanager
    def owned(self):
        if not self._guard.acquire(False):
            raise RuntimeError('Queue busy')
        try:
            if self.closed or self.failed:
                raise RuntimeError('Queue closed or storage uncertain; reopen before continuing')
            yield
        finally:
            self._guard.release()

    def _commit(self, records):
        text = json.dumps({'version': 1, 'key_id': self.key_id, 'kind': self.kind, 'records': records}, separators=(',', ':'))
        blob = json.dumps({'snapshot': text, 'sha256': hashlib.sha256(text.encode()).hexdigest()}).encode()
        temporary = self.file.with_name(self.file.name + '.' + secrets.token_hex(8) + '.tmp')
        try:
            fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(blob)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.file)
            if os.name != 'nt':
                directory = os.open(self.file.parent, os.O_RDONLY)
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
            self.records = records
        except BaseException:
            self.failed = True
            raise
        finally:
            temporary.unlink(missing_ok=True)

    def enqueue(self, version, payload, *, ttl_seconds=86400, now=None):
        with self.owned():
            if self.kind != 'telemetry' or type(version) is not int or not 1 <= version <= 255 or not isinstance(payload, bytes) or not 1 <= len(payload) <= 1286 or type(ttl_seconds) is not int or not 1 <= ttl_seconds <= 2592000:
                raise ValueError('Invalid queued event')
            if len(self.records) >= self.capacity:
                raise RuntimeError('Queue full')
            event = secrets.token_hex(16)
            self._commit(self.records + [{'id': event, 'version': version, 'payload': payload.hex(), 'expires': (time.time() if now is None else now) + ttl_seconds}])
            return event

    def flush_one(self, client, **delivery):
        with self.owned():
            if self.kind != 'telemetry' or client.key_id != self.key_id:
                raise ValueError('Queue/client identity mismatch')
            if not self.records:
                return {'status': 'idle'}
            head = self.records[0]
            if head['expires'] <= time.time():
                return {'status': 'expired'}
            result = client.send(head['version'], bytes.fromhex(head['payload']), **{**delivery, 'confirmed': True, 'event_id': bytes.fromhex(head['id'])})
            if result['status'] == 'committed':
                self._commit(self.records[1:])
            return result

    def discard(self, event_id):
        with self.owned():
            if not self.records or self.records[0]['id'] != event_id:
                raise ValueError('Only the explicit queue head can be discarded')
            self._commit(self.records[1:])

    def close(self):
        if not self._guard.acquire(False):
            raise RuntimeError('Queue busy')
        try:
            if not self.closed:
                self.closed = True
                os.close(self._fd)
                self.lock_path.unlink()
        finally:
            self._guard.release()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
