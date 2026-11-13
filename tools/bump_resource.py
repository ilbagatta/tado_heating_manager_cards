"""Gira SUL server (add-on SSH): imposta ?v=<versione> nella risorsa Lovelace delle card.

Uso: ssh root@<host> python3 - <versione> < tools/bump_resource.py
Solo libreria standard (nell'add-on non ci sono websockets/aiohttp): client WebSocket minimo verso il proxy del Supervisor.
"""

import base64
import json
import os
import socket
import struct
import sys

FILE = "tado-heating-manager-cards.js"
version = sys.argv[1]
new_url = f"/local/{FILE}?v={version}"


def send(sock, obj):
    data = json.dumps(obj).encode()
    mask = os.urandom(4)
    n = len(data)
    head = bytes([0x81])
    if n < 126:
        head += bytes([0x80 | n])
    elif n < 65536:
        head += bytes([0x80 | 126]) + struct.pack(">H", n)
    else:
        head += bytes([0x80 | 127]) + struct.pack(">Q", n)
    sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


def read_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("connessione chiusa")
        buf += chunk
    return buf


def recv(sock):
    payload = b""
    while True:
        b1, b2 = read_exact(sock, 2)
        n = b2 & 0x7F
        if n == 126:
            n = struct.unpack(">H", read_exact(sock, 2))[0]
        elif n == 127:
            n = struct.unpack(">Q", read_exact(sock, 8))[0]
        payload += read_exact(sock, n)
        if b1 & 0x80:  # FIN
            return json.loads(payload)


def call(sock, msg_id, **msg):
    send(sock, {"id": msg_id, **msg})
    while True:
        res = recv(sock)
        if res.get("id") == msg_id:
            if not res.get("success"):
                sys.exit(f"Errore da HA: {res.get('error')}")
            return res.get("result")


sock = socket.create_connection(("supervisor", 80), timeout=15)
key = base64.b64encode(os.urandom(16)).decode()
sock.sendall(
    (
        "GET /core/websocket HTTP/1.1\r\nHost: supervisor\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    ).encode(),
)
resp = b""
while b"\r\n\r\n" not in resp:
    resp += sock.recv(1024)
if b" 101 " not in resp.split(b"\r\n", 1)[0]:
    sys.exit(f"Handshake fallito: {resp[:200]!r}")

recv(sock)  # auth_required
send(sock, {"type": "auth", "access_token": os.environ["SUPERVISOR_TOKEN"]})
if recv(sock).get("type") != "auth_ok":
    sys.exit("Autenticazione fallita")

items = [r for r in call(sock, 1, type="lovelace/resources") if FILE in r["url"]]
if not items:
    call(sock, 2, type="lovelace/resources/create", res_type="module", url=new_url)
    print(f"Risorsa creata: {new_url}")
else:
    res = items[0]
    if res["url"] == new_url:
        print(f"Risorsa gia' a {new_url}")
    else:
        call(sock, 2, type="lovelace/resources/update", resource_id=res["id"], res_type="module", url=new_url)
        print(f"Risorsa: {res['url']} -> {new_url}")
