#!/usr/bin/env python3
"""Tests for relay-gate.py against a stand-in for go2rtc on loopback: python3 test_relay_gate.py

The gate must pass only a WebSocket upgrade for <name>_av with the right token, and only tunnel once
go2rtc has answered 101; a 2026-10-20 review got a second, arbitrary request through to go2rtc's API
by sending it after a plain one on the same connection.
"""
import asyncio, importlib.util, os, shutil, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN = 'test-token_123'
UPGRADE = ('GET /{token}/api/ws?src={src} HTTP/1.1\r\nHost: relay\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
           'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nAuthorization: Basic eDp5\r\n\r\n')


def load_gate(tmp):
    shutil.copy(os.path.join(HERE, 'relay-gate.py'), os.path.join(tmp, 'relay_gate.py'))
    with open(os.path.join(tmp, 'relay-gate.token'), 'w') as f:
        f.write(TOKEN)
    spec = importlib.util.spec_from_file_location('relay_gate', os.path.join(tmp, 'relay_gate.py'))
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    return gate


class Upstream:
    """A fake go2rtc: records every byte it gets; answers 101 to an upgrade, or 200 when told to."""
    def __init__(self, answer):
        self.answer, self.got = answer, b''

    async def handle(self, reader, writer):
        head = await reader.readuntil(b'\r\n\r\n')
        self.got += head
        writer.write(self.answer)
        await writer.drain()
        try:
            while data := await asyncio.wait_for(reader.read(4096), 1):
                self.got += data
        except Exception:
            pass
        writer.close()


class GateTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.mkdtemp()
        self.gate = load_gate(self.tmp)

    async def asyncTearDown(self):
        shutil.rmtree(self.tmp)

    async def run_case(self, send, answer=b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'):
        up = Upstream(answer)
        up_server = await asyncio.start_server(up.handle, '127.0.0.1', 0)
        self.gate.UPSTREAM = ('127.0.0.1', up_server.sockets[0].getsockname()[1])
        gate_server = await asyncio.start_server(self.gate.handle, '127.0.0.1', 0)
        r, w = await asyncio.open_connection('127.0.0.1', gate_server.sockets[0].getsockname()[1])
        w.write(send)
        await w.drain()
        try:
            got = await asyncio.wait_for(r.read(4096), 2)
        except asyncio.TimeoutError:
            got = b''
        await asyncio.sleep(0.3)
        w.close()
        gate_server.close(); up_server.close()
        return got, up.got

    async def test_upgrade_is_relayed_without_token_or_credentials(self):
        got, upstream = await self.run_case(UPGRADE.format(token=TOKEN, src='front_door_av').encode() + b'\x81\x02hi')
        self.assertTrue(got.startswith(b'HTTP/1.1 101'))
        self.assertTrue(upstream.startswith(b'GET /api/ws?src=front_door_av HTTP/1.1\r\n'))
        self.assertNotIn(TOKEN.encode(), upstream)
        self.assertNotIn(b'Authorization', upstream)
        self.assertTrue(upstream.endswith(b'\x81\x02hi'))  # frames after the handshake go through

    async def test_plain_request_then_another_is_refused(self):
        # The review's case: an allowed first line without an upgrade, then a second request.
        send = (f'GET /{TOKEN}/api/ws?src=test_av HTTP/1.1\r\nHost: relay\r\n\r\n'
                'GET /api/config HTTP/1.1\r\nHost: relay\r\n\r\n').encode()
        got, upstream = await self.run_case(send)
        self.assertTrue(got.startswith(b'HTTP/1.1 400'))
        self.assertEqual(upstream, b'')

    async def test_nothing_more_reaches_go2rtc_unless_it_answers_101(self):
        send = UPGRADE.format(token=TOKEN, src='front_door_av').encode() + b'GET /api/config HTTP/1.1\r\nHost: relay\r\n\r\n'
        got, upstream = await self.run_case(send, answer=b'HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n')
        self.assertTrue(got.startswith(b'HTTP/1.1 200'))
        self.assertNotIn(b'/api/config', upstream)

    async def test_wrong_token_and_other_paths_are_refused(self):
        for line in (UPGRADE.format(token='wrong', src='front_door_av'), UPGRADE.format(token=TOKEN, src='front_door'),
                     UPGRADE.format(token=TOKEN, src='front_door_av').replace('/api/ws?src=front_door_av', '/api/config')):
            got, upstream = await self.run_case(line.encode())
            self.assertTrue(got.startswith(b'HTTP/1.1 403'), line.split('\r\n')[0])
            self.assertEqual(upstream, b'')

    async def test_probe_answers(self):
        got, upstream = await self.run_case(b'GET / HTTP/1.1\r\nHost: relay\r\n\r\n')
        self.assertTrue(got.startswith(b'HTTP/1.1 204'))
        self.assertEqual(upstream, b'')


if __name__ == '__main__':
    unittest.main(verbosity=1)
