import asyncio
import json
import time

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.models import WorldState, DataMode
from backend.app.models.device import VehicleTelemetryPacket, LoadTelemetry
from backend.app.twin.world_store import WorldStore
from backend.app.main import create_app
from backend.app.config import RuntimeSettings
from backend.tests.test_live_runtime import LIVE_PACKET, OnePacketThenSilence
from backend.app.providers.serial_protocol import parse_main_packet


def packet(vehicle_id="DUMPER_02", **kwargs):
    return VehicleTelemetryPacket(vehicle_id=vehicle_id, seq=1, ms=100, **kwargs)


def test_no_fix_and_uncalibrated_data_cannot_be_reported_as_valid():
    sample = packet(gps={"fix": False, "lat": 12, "lon": 77, "age": 0})
    assert sample.gps.lat is None
    assert LoadTelemetry(ready=True, raw=123, age=0, calibrated=False, kg=99).kg is None
    with pytest.raises(ValidationError):
        packet(gps={"fix": True, "lat": float("nan"), "lon": 77, "age": 0})


def test_both_trucks_survive_main_replacement_and_expire(monkeypatch):
    async def run():
        monkeypatch.setattr("backend.app.twin.world_store.now_ms", lambda: 10000)
        store = WorldStore(WorldState(mode=DataMode.LIVE))
        for vehicle in ("DUMPER_01", "DUMPER_02"):
            await store.accept_vehicle(packet(vehicle, gps={"fix": True, "lat": 12, "lon": 77, "age": 0},
                load={"ready": True, "raw": 100, "age": 0, "calibrated": True, "kg": 1}))
        await store.replace(WorldState(mode=DataMode.LIVE, sequence=5))
        state = await store.snapshot()
        assert len(state.vehicle_telemetry) == 2
        assert all(v.gps.fix for v in state.vehicle_telemetry)
        monkeypatch.setattr("backend.app.twin.world_store.now_ms", lambda: 16001)
        stale = await store.stream_snapshot(state.sequence)
        assert stale is not None
        state = await store.snapshot()
        assert all(not v.online and not v.gps.fix and v.load.kg is None for v in state.vehicle_telemetry)
        await store.replace(WorldState(mode=DataMode.SIMULATED))
        assert not (await store.snapshot()).vehicle_telemetry
    asyncio.run(run())


def test_http_live_only_and_world_visibility():
    payload = packet().model_dump(by_alias=True)
    with TestClient(create_app(RuntimeSettings())) as client:
        assert client.post("/api/telemetry/vehicle", json=payload).status_code == 409
    settings = RuntimeSettings(runtime_mode="LIVE", telemetry_transport="WIFI", wifi_listen_port=18765)
    with TestClient(create_app(settings)) as client:
        assert client.post("/api/telemetry/vehicle", json=payload).status_code == 200
        items = client.get("/api/world").json()["vehicle_telemetry"]
        assert items[0]["vehicle_id"] == "DUMPER_02"
        assert items[0]["gps"]["fix"] is False
        assert client.get("/api/world").json()["v2x"]["active_peers"] == []


def test_main_sensor_stream_preserves_gps_and_load_in_world():
    class MainWithGpsLoad(OnePacketThenSilence):
        def __init__(self, port, baud):
            super().__init__(port, baud)
            raw = json.loads(LIVE_PACKET)
            raw["gps"] = {"fix": True, "lat": 12, "lon": 77, "age": 0, "sats": 7}
            raw["load"] = {"ready": True, "raw": 123456, "age": 0, "calibrated": False}
            self._packets = [parse_main_packet(json.dumps(raw))]
    settings = RuntimeSettings(runtime_mode="LIVE", serial_port="TEST", serial_stale_ms=5000)
    with TestClient(create_app(settings, serial_factory=MainWithGpsLoad)) as client:
        deadline = time.monotonic() + 1
        items = []
        while time.monotonic() < deadline:
            items = client.get("/api/world").json()["vehicle_telemetry"]
            if items:
                break
            time.sleep(0.01)
        assert items[0]["vehicle_id"] == "DUMPER_01"
        assert items[0]["gps"]["lat"] == 12
        assert items[0]["load"]["raw"] == 123456
        assert items[0]["load"]["kg"] is None
