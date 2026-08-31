from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

from backend.app.providers.serial_protocol import MainTelemetryPacket


class TelemetryReader(Protocol):
    @property
    def port(self) -> str: ...

    def poll(self) -> list[MainTelemetryPacket]: ...

    def close(self) -> None: ...


@dataclass(frozen=True)
class TelemetrySource:
    name: str
    endpoint: str
    open_reader: Callable[[], TelemetryReader]


@dataclass
class _SourceState:
    source: TelemetrySource
    reader: TelemetryReader | None = None
    retry_at: float = 0.0
    last_error: str | None = None
    last_packet_at: float | None = None


class RedundantTelemetryReader:
    """Merge independent MAIN inputs while allowing either one to fail."""

    def __init__(
        self,
        sources: Sequence[TelemetrySource],
        reconnect_ms: int = 1_000,
        source_stale_ms: int = 1_500,
    ) -> None:
        if not sources:
            raise ValueError("At least one telemetry source is required")
        self._sources = [_SourceState(source=source) for source in sources]
        self._reconnect_s = reconnect_ms / 1_000.0
        self._source_stale_s = source_stale_ms / 1_000.0
        self._closed = False

    @property
    def port(self) -> str:
        return " + ".join(
            f"{state.source.name} {state.source.endpoint}"
            for state in self._sources
        )

    @property
    def active_sources(self) -> tuple[str, ...]:
        current_time = time.monotonic()
        return tuple(
            state.source.name
            for state in self._sources
            if state.reader is not None
            and state.last_packet_at is not None
            and current_time - state.last_packet_at <= self._source_stale_s
        )

    @property
    def source_errors(self) -> dict[str, str]:
        return {
            state.source.name: state.last_error
            for state in self._sources
            if state.last_error is not None
        }

    def _close_source(self, state: _SourceState) -> None:
        reader, state.reader = state.reader, None
        if reader is None:
            return
        try:
            reader.close()
        except Exception:
            pass

    def poll(self) -> list[MainTelemetryPacket]:
        if self._closed:
            return []

        packets: list[MainTelemetryPacket] = []
        current_time = time.monotonic()
        for state in self._sources:
            if state.reader is None and current_time >= state.retry_at:
                try:
                    state.reader = state.source.open_reader()
                    state.last_error = None
                except Exception as exc:
                    state.last_error = str(exc)
                    state.retry_at = current_time + self._reconnect_s
                    continue

            if state.reader is None:
                continue
            try:
                source_packets = state.reader.poll()
                if source_packets:
                    state.last_packet_at = current_time
                    state.last_error = None
                    packets.extend(source_packets)
            except Exception as exc:
                state.last_error = str(exc)
                self._close_source(state)
                state.retry_at = current_time + self._reconnect_s

        return packets

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        for state in self._sources:
            self._close_source(state)
