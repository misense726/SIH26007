from __future__ import annotations

import socketserver
import socket
import threading
from collections import deque

from backend.app.providers.serial_protocol import (
    BoundedLineBuffer,
    MainTelemetryPacket,
    parse_main_packet,
)


class _ThreadingTelemetryServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(
        self,
        address: tuple[str, int],
        owner: "WifiTelemetryListener",
    ) -> None:
        self.owner = owner
        super().__init__(address, _TelemetryHandler)


class _TelemetryHandler(socketserver.BaseRequestHandler):
    server: _ThreadingTelemetryServer

    def handle(self) -> None:
        owner = self.server.owner
        lines = BoundedLineBuffer()
        owner._client_connected(self.request)
        try:
            while not owner.closed:
                chunk = self.request.recv(4096)
                if not chunk:
                    break
                for line in lines.feed(chunk):
                    owner._accept_line(line)
        except OSError:
            return
        finally:
            owner._add_discarded(lines.discarded_lines)
            owner._client_disconnected(self.request)


class WifiTelemetryListener:
    """Threaded TCP NDJSON listener with bounded packet buffering."""

    def __init__(
        self,
        host: str,
        port: int,
        maximum_packets: int = 64,
    ) -> None:
        self._lock = threading.Lock()
        self._packets: deque[MainTelemetryPacket] = deque(maxlen=maximum_packets)
        self.invalid_packets = 0
        self.discarded_lines = 0
        self.dropped_packets = 0
        self.connected_clients = 0
        self.closed = False
        self._active_socket: socket.socket | None = None
        self._server = _ThreadingTelemetryServer((host, port), self)
        bound_host, bound_port = self._server.server_address[:2]
        self.listen_host = str(bound_host)
        self.listen_port = int(bound_port)
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="fogsen-wifi-listener",
            daemon=True,
        )
        self._thread.start()

    @property
    def port(self) -> str:
        return f"WIFI {self.listen_host}:{self.listen_port}"

    def _client_connected(self, client: socket.socket) -> None:
        previous: socket.socket | None
        with self._lock:
            previous = self._active_socket
            self._active_socket = client
            self.connected_clients = 1
        if previous is not None and previous is not client:
            try:
                previous.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            previous.close()

    def _client_disconnected(self, client: socket.socket) -> None:
        with self._lock:
            if self._active_socket is client:
                self._active_socket = None
                self.connected_clients = 0

    def _add_discarded(self, count: int) -> None:
        with self._lock:
            self.discarded_lines += count

    def _accept_line(self, line: bytes) -> None:
        try:
            packet = parse_main_packet(line)
        except ValueError:
            with self._lock:
                self.invalid_packets += 1
            return
        with self._lock:
            if len(self._packets) == self._packets.maxlen:
                self.dropped_packets += 1
            self._packets.append(packet)

    def poll(self) -> list[MainTelemetryPacket]:
        with self._lock:
            packets = list(self._packets)
            self._packets.clear()
        return packets

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        with self._lock:
            active_socket, self._active_socket = self._active_socket, None
            self.connected_clients = 0
        if active_socket is not None:
            try:
                active_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            active_socket.close()
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=2.0)
