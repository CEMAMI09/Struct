import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from struct_device import build_frame
from struct_persistent import PersistentQueue
from struct_commands import CommandReceiver


class ParityTests(unittest.TestCase):
    def test_encryption_and_v4_vectors(self):
        fixtures = json.loads((Path(__file__).parents[1] / 'tests/protocol-vectors.json').read_text())
        for v in fixtures['vectors']:
            with patch('struct_device.secrets.token_bytes', return_value=bytes.fromhex(v.get('encryptionNonceHex', '00'*12))):
                frame = build_frame(v['keyId'], v['apiSecret'], v['schemaVersion'], bytes.fromhex(v['payloadHex']),
                                    confirmed=v['protocol'] == 3, timestamp_sec=v['timestampSec'], nonce=bytes.fromhex(v['nonceHex']), encryption_key=v.get('encryptionKey'))
            self.assertEqual(frame.hex(), v['frameHex'])
        v = json.loads((Path(__file__).parents[1] / 'tests/delivery-vectors.json').read_text())
        self.assertEqual(build_frame(v['keyId'], v['apiSecret'], v['schemaVersion'], bytes.fromhex(v['payloadHex']),
                         confirmed=True, timestamp_sec=v['timestampSec'], nonce=bytes.fromhex(v['nonceHex']), event_id=bytes.fromhex(v['eventIdHex'])).hex(), v['frameHex'])

    def test_queue_reopen_unknown_commit_and_full(self):
        key = '0123456789abcdef'
        class Client:
            key_id = key
            status = 'unknown'
            ids = []
            def send(self, version, payload, **kwargs):
                self.ids.append(kwargs['event_id'].hex())
                return {'status': self.status}
        client = Client()
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'queue.json'
            with PersistentQueue(file, key, 1) as queue:
                event = queue.enqueue(1, b'x')
                with self.assertRaises(RuntimeError):
                    queue.enqueue(1, b'y')
                self.assertEqual(queue.flush_one(client)['status'], 'unknown')
            with PersistentQueue(file, key, 1) as queue:
                client.status = 'committed'
                queue.flush_one(client)
                self.assertEqual(queue.records, [])
            self.assertEqual(client.ids, [event, event])

    def test_commands_dedup_and_crash_window(self):
        v = json.loads((Path(__file__).parents[1] / 'tests/delivery-vectors.json').read_text())
        frame = bytes.fromhex(v['commandHex'])
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'commands.json'
            executed = []
            for _ in range(2):
                receiver = CommandReceiver(file, v['keyId'], v['apiSecret'])
                try:
                    result = receiver.handle(frame, lambda cmd: executed.append(cmd['id']) or 'executed', now=1001)
                    self.assertEqual(result, 'executed')
                finally:
                    receiver.close()
            self.assertEqual(len(executed), 1)

    def test_uncertain_write_requires_reopen(self):
        with tempfile.TemporaryDirectory() as directory:
            with PersistentQueue(Path(directory) / 'queue', '0123456789abcdef') as queue:
                with patch('struct_persistent.os.replace', side_effect=OSError('power cut')):
                    with self.assertRaises(OSError):
                        queue.enqueue(1, b'x')
                with self.assertRaises(RuntimeError):
                    queue.enqueue(1, b'y')


if __name__ == '__main__':
    unittest.main()
