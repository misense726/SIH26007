from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class GpsTelemetry(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    fix: bool = False
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    alt_m: float | None = None
    speed_mps: float | None = Field(default=None, ge=0)
    sats: int = Field(default=0, ge=0, le=100)
    hdop: float | None = Field(default=None, ge=0)
    age: int | None = Field(default=None, ge=0)
    bytes: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def valid_fix(self):
        if not self.fix or self.lat is None or self.lon is None or self.age is None or self.age > 5000:
            self.fix = False
            self.lat = self.lon = self.alt_m = self.speed_mps = self.hdop = None
        return self


class LoadTelemetry(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    ready: bool = False
    tared: bool = False
    taring: bool = False
    calibrated: bool = False
    zero_offset: int = Field(default=0, ge=-8388608, le=8388607)
    raw: int | None = Field(default=None, ge=-8388608, le=8388607)
    net_raw: int | None = Field(default=None, ge=-16777215, le=16777215)
    kg: float | None = None
    age: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def valid_load(self):
        if self.age is None or self.age > 1000 or self.raw is None:
            self.ready = False
        if not self.ready:
            self.raw = self.net_raw = None
            self.taring = False
        if not self.ready or not self.calibrated:
            self.kg = None
        return self


class VehicleTelemetryPacket(BaseModel):
    schema_version: Literal["fogsen.vehicle.v1"] = Field(default="fogsen.vehicle.v1", alias="schema")
    vehicle_id: Literal["DUMPER_01", "DUMPER_02"]
    mode: Literal["LIVE"] = "LIVE"
    seq: int = Field(ge=0)
    ms: int = Field(ge=0)
    gps: GpsTelemetry = Field(default_factory=GpsTelemetry)
    load: LoadTelemetry | None = None


class VehicleTelemetry(VehicleTelemetryPacket):
    received_at_ms: int
    online: bool = True
