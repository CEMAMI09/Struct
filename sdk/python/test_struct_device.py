import socket
import struct
import threading
import unittest
import hmac
import json
from pathlib import Path
from struct_device import StructClient, build_frame
SECRET = 'aa' * 32
KEY = '0123456789abcdef'
class DeviceTests(unittest.TestCase):
    def test_frozen_protocol_vectors(self):
        fixtures = json.loads((Path(__file__).resolve().parents[1] / 'tests/protocol-vectors.json').read_text())
        for vector in fixtures['vectors']:
            if 'encryptionKey' in vector:
                continue  # Python SDK intentionally does not implement encryption.
            with self.subTest(vector=vector['name']):
                actual = build_frame(vector['keyId'], vector['apiSecret'], vector['schemaVersion'],
                    bytes.fromhex(vector['payloadHex']), confirmed=vector['protocol'] == 3,
                    timestamp_sec=vector['timestampSec'], nonce=bytes.fromhex(vector['nonceHex']))
                self.assertEqual(actual.hex(), vector['frameHex'])

    def test_frame(self):
        payload = struct.pack('<fiB', 23.5, -42, 1)
        frame = build_frame(KEY, SECRET, 1, payload, confirmed=True, timestamp_sec=1700000000, nonce=bytes([7])*12)
        self.assertEqual(frame[:34], struct.pack('<B16sBI12s', 3, KEY.encode(), 1, 1700000000, bytes([7])*12))
        self.assertEqual(frame[-32:], hmac.digest(SECRET.encode(), frame[:-32], 'sha256'))
        for version in [0, 256, 1.1, True]:
            with self.assertRaises(ValueError): build_frame(KEY, SECRET, version, payload)
    def test_dropped_receipt(self):
        server = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        server.bind(('127.0.0.1', 0)); server.settimeout(4)
        frames = []
        def serve():
            try:
                for _ in range(2):
                    frame, peer = server.recvfrom(1400); frames.append(frame)
                body = b'STRA' + frame[-32:] + b'\x01'
                server.sendto(body + hmac.digest(SECRET.encode(), body, 'sha256'), peer)
            finally: server.close()
        thread = threading.Thread(target=serve)
        port = server.getsockname()[1]; thread.start()
        result = StructClient('127.0.0.1', KEY, SECRET, port).send(1, b'*', confirmed=True, retry_ms=1000, budget_ms=3000)
        thread.join()
        self.assertEqual(result['status'], 'committed')
        self.assertEqual(result['attempts'], 2)
        self.assertTrue(result['duplicate'])
        self.assertEqual(frames[0], frames[1])
    def test_timeout(self):
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as server:
            server.bind(('127.0.0.1', 0))
            client = StructClient('127.0.0.1', KEY, SECRET, server.getsockname()[1])
            self.assertEqual(client.send(1, b'*', confirmed=True, max_retries=0, budget_ms=50)['status'], 'unknown')
            self.assertEqual(client.send(1, b'*')['status'], 'sent')
if __name__ == '__main__': unittest.main()
