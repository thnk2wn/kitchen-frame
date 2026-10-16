#!/usr/bin/env python3
"""A gate in front of go2rtc's API for kitchen-frame's camera view.

The frame's page can't send go2rtc a password: browsers drop credentials written in a WebSocket
address, and a cross-origin request with an Authorization header needs a preflight that go2rtc
answers 401. So go2rtc's API listens on loopback only (where it needs no password), and this gate,
on the home network, lets through only WebSocket signalling requests whose path starts with the
secret token: GET /<token>/api/ws?src=<name>_av. Everything else is refused. The token is in
relay-gate.token next to this file (and the Worker's CAMERA_RELAY secret).
"""
import asyncio, hmac, os, re, sys

LISTEN = ('0.0.0.0', 1985)
UPSTREAM = ('127.0.0.1', 1984)
HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN = open(os.path.join(HERE, 'relay-gate.token')).read().strip().encode()
REQ = re.compile(rb'^GET /([A-Za-z0-9_-]+)(/api/ws\?src=[A-Za-z0-9_]+) HTTP/1\.1$')


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
    # Forward without the token and without any credentials the browser added.
    out = [b'GET ' + m.group(2) + b' HTTP/1.1'] + [l for l in lines[1:] if not l.lower().startswith(b'authorization:')]
    try:
        up_r, up_w = await asyncio.open_connection(*UPSTREAM)
    except OSError:
        return await reply(writer, b'502 Bad Gateway')
    up_w.write(b'\r\n'.join(out))
    await up_w.drain()
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
