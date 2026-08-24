from __future__ import annotations

import json
from collections import deque
from typing import Any

from backend.app.providers.serial_protocol import (
    BoundedLineBuffer,
    MainTelemetryPacket,
    parse_main_packet,
)


class MainControllerSerial:
    """Non-blocking USB serial reader for the wired MAIN controller link."""

    def __init__(self, port: str, baud: int = 115200) -> None:
        try:
            import serial
        except ImportError as exc:
            raise RuntimeError("Install FogSen with the hardware extra to use live USB serial") from exc
        self._serial = serial.Serial(port=port, baudrate=baud, timeout=0, write_timeout=0)
        self._lines = BoundedLineBuffer()
        self._events: deque[dict[str, Any]] = deque(maxlen=16)
        self.invalid_packets = 0
        self.event_messages = 0

    @property
    def port(self) -> str:
        return str(self._serial.port)

    def poll(self) -> list[MainTelemetryPacket]:
        waiting = min(int(self._serial.in_waiting), 4096)
        if waiting <= 0:
            return []
        packets = []
        for line in self._lines.feed(self._serial.read(waiting)):
            try:
                packets.append(parse_main_packet(line))
            except ValueError:
                try:
                    event = json.loads(line)
                except (UnicodeDecodeError, json.JSONDecodeError):
                    self.invalid_packets += 1
                    continue
                if isinstance(event, dict) and event.get("type") in {
                    "boot",
                    "command_reply",
                }:
                    self._events.append(event)
                    self.event_messages += 1
                else:
                    self.invalid_packets += 1
        return packets

    def drain_events(self) -> list[dict[str, Any]]:
        events = list(self._events)
        self._events.clear()
        return events

    @property
    def discarded_lines(self) -> int:
        return self._lines.discarded_lines

    def send_command(self, command: str) -> None:
        clean = command.strip().upper()
        if not clean or len(clean) > 64 or "\n" in clean or "\r" in clean:
            raise ValueError("MAIN command must be a single non-empty line of at most 64 characters")
        self._serial.write(f"{clean}\n".encode("ascii"))

    def close(self) -> None:
        self._serial.close()
