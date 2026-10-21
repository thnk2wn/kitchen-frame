#!/usr/bin/env python3
"""A gate in front of go2rtc's API for kitchen-frame's camera view.

The frame's page can't send go2rtc a password: browsers drop credentials written in a WebSocket
address, and a cross-origin request with an Authorization header needs a preflight that go2rtc
answers 401. So go2rtc's API listens on loopback only (where it needs no password), and this gate,
on the home network, lets through only WebSocket signalling requests whose path starts with the
secret token: GET /<token>/api/ws?src=<name>_av. Everything else is refused. The token is in
relay-gate.token next to this file (and the Worker's CAMERA_RELAY secret).

Only a WebSocket upgrade is let through, and only once go2rtc has accepted it (101 Switching
Protocols): from then on the connection carries WebSocket frames, which go2rtc doesn't read as new
HTTP requests. Before 2026-10-20 the gate piped the connection as soon as the first line matched, so a
plain request could be followed by any other on the same connection, straight into go2rtc's API
(a security review found it; test_relay_gate.py keeps it closed).
"""
import asyncio, hmac, os, re, sys

LISTEN = ('0.0.0.0', 1985)
UPSTREAM = ('127.0.0.1', 1984)
HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN = open(os.path.join(HERE, 'relay-gate.token')).read().strip().encode()
REQ = re.compile(rb'^GET /([A-Za-z0-9_-]+)(/api/ws\?src=[A-Za-z0-9_]+_av) HTTP/1\.1$')


async def pipe(reader, writer):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def reply(writer, status):
    # A reply any page can read: the frame's probe only needs to see that something answered.
    writer.write(b'HTTP/1.1 ' + status + b'\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
    try:
        await writer.drain()
    finally:
        writer.close()


async def handle(reader, writer):
    peer = writer.get_extra_info('peername')
    who = peer[0] if peer else '?'
    try:
        head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 5)
    except Exception:
        writer.close()
        return
    lines = head.split(b'\r\n')
    # The frame's "is the relay there?" probe.
    if lines[0].startswith(b'GET / '):
        return await reply(writer, b'204 No Content')
    m = REQ.match(lines[0])
    if not m or not hmac.compare_digest(m.group(1), TOKEN):
        print('refused', who, lines[0].split(b' ')[0].decode('latin-1'), flush=True)
        return await reply(writer, b'403 Forbidden')
    headers = {}
    for l in lines[1:]:
        k, _, v = l.partition(b':')
        headers[k.strip().lower()] = v.strip().lower()
    # A WebSocket upgrade and nothing else: no body, no other method, no plain HTTP request.
    if headers.get(b'upgrade') != b'websocket' or b'upgrade' not in headers.get(b'connection', b'') \
            or b'sec-websocket-key' not in headers or b'content-length' in headers or b'transfer-encoding' in headers:
        print('refused', who, 'not a websocket upgrade', flush=True)
        return await reply(writer, b'400 Bad Request')
    # Forward without the token and without any credentials the browser added.
    out = [b'GET ' + m.group(2) + b' HTTP/1.1'] + [l for l in lines[1:] if l and not l.lower().startswith(b'authorization:')]
    try:
        up_r, up_w = await asyncio.open_connection(*UPSTREAM)
    except OSError:
        return await reply(writer, b'502 Bad Gateway')
    up_w.write(b'\r\n'.join(out) + b'\r\n\r\n')
    await up_w.drain()
    # go2rtc's answer to the handshake: only a 101 opens the tunnel; anything else is passed back and
    # the connection closed, so nothing more reaches go2rtc on it.
    try:
        answer = await asyncio.wait_for(up_r.readuntil(b'\r\n\r\n'), 15)
    except Exception:
        up_w.close()
        return await reply(writer, b'502 Bad Gateway')
    writer.write(answer)
    await writer.drain()
    if not answer.startswith(b'HTTP/1.1 101'):
        up_w.close()
        writer.close()
        print('refused', who, 'go2rtc answered', answer.split(b'\r\n')[0].decode('latin-1'), flush=True)
        return
    print('relay', who, m.group(2).decode('latin-1'), flush=True)
    await asyncio.gather(pipe(reader, up_w), pipe(up_r, writer))


async def main():
    server = await asyncio.start_server(handle, *LISTEN, limit=16384)
    print('relay-gate listening on %s:%d' % LISTEN, flush=True)
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
