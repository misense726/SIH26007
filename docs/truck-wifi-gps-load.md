# Direct Wi-Fi truck telemetry

Truck 2 uses `firmware/truck2_esp8266` on NodeMCU ESP8266. It sends one HTTP
JSON sample per second directly to `/api/telemetry/vehicle` on the PC backend.
The LoRa radio and base station are no longer involved. GPS TX stays on D1,
GPS RX is unconnected, and grounds are common. Power the GPS breakout according
to its marked supply rating. Disconnect the unused radio with power off.

Truck 1 uses `firmware/main_esp32`. Existing ToF, UART, IMU, BMP280 and safety
logic remain. Full MAIN telemetry uses its existing bounded Wi-Fi TCP queue,
port 8765, at 20 Hz. USB carries the same full packets as a local fallback,
along with diagnostic events and commands. Credentials reside only in ignored
`wifi_secrets.h` files. Example headers contain placeholders.

The PC's verified Quarks Wi-Fi address for this setup was 10.31.48.242. If DHCP changes
that address, update both ignored headers and rebuild/upload the boards.

## Truck 1 additional wiring

| Module | Pin | ESP32 MAIN |
|---|---|---|
| NEO-6 | TX | GPIO34 |
| NEO-6 | RX | unconnected |
| NEO-6 | GND | GND |
| NEO-6 | VCC | breakout-rated supply |
| HX711 | DT / DOUT | GPIO19 |
| HX711 | SCK / CLK | GPIO18 |
| HX711 | VCC | 3.3 V |
| HX711 | GND | GND |

GPIO34 is a receive-only input with no internal pull-up. Receive-only software
UART at 9600 baud preserves MAIN's two hardware UART links and USB diagnostics.
GPIO18 and GPIO19 are free because this profile has no LoRa/SPI peripheral.
Keep GPIO32, GPIO33 and GPIO25 unconnected. HX711 readiness is checked before
reading; missing hardware cannot initiate an unbounded wait in the normal poll.
Connect the load cell's excitation pair to E+/E- and signal pair to A+/A-
according to its documentation, not assumed wire colours. Use 3.3 V-compatible
signal levels on all ESP32 inputs.

## Load calibration

The firmware reports raw HX711 counts immediately when available. The first
unloaded baseline was calculated from 86 live samples, then the on-device tare
stored the current zero offset as `-286025`. Kilograms remain null until one
known reference mass is measured. It never automatically tares a possibly loaded
truck at startup.

Send `TARE_LOAD` over MAIN USB while the platform is empty to collect 32 fresh
samples and save the new zero offset in ESP32 nonvolatile storage. The saved tare
survives restart. This removes power-cycle offset drift without silently taring a
loaded platform.

1. With the platform unloaded, record a stable raw reading R0.
2. Place a known mass M in kilograms and record a stable reading R1.
3. In `firmware/main_esp32/src/LoadCellConfig.h`, set `kZeroOffset` to R0 and
   `kCountsPerKg` to `(R1 - R0) / M`. Preserve the sign.
4. Rebuild, upload, and verify several known masses. Changing the cell or
   mechanical mounting requires recalibration.

Load data expires after one second. GPS fixes expire after five seconds.
Disconnected trucks become offline after five seconds. Missing/uncalibrated
readings stay unavailable rather than becoming zero kilograms or valid positions.

## Backend and dashboard

Run from the MI Sense root:

```powershell
$env:FOGSEN_MODE = 'LIVE'
$env:FOGSEN_TELEMETRY_TRANSPORT = 'WIFI'
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

In another terminal, run `npm run dev:local` from `frontend`. Open
`http://127.0.0.1:5173/#fleet`. The Truck GPS and load panel shows connection,
latitude/longitude when valid, satellites, raw load counts and calibrated kg.
`/api/world` and `/ws/telemetry` expose the same backend-owned
`vehicle_telemetry` records. Truck 1 is DUMPER_01; truck 2 is DUMPER_02.
The HTTP endpoint rejects data when the backend is not LIVE. MAIN's existing
sensor protocol remains on TCP 8765 so truck 2 cannot evict its connection.

GPS coordinates are displayed as geographic coordinates. They do not silently
replace the reference map's local Cartesian pose. A surveyed GPS-to-map transform
is still needed for positioning trucks on that map. NEO-6 data is not RTK, and
load-cell/GPS telemetry does not become emergency-stop truth.

## Verified on 2026-09-09

- NodeMCU build `esp8266:esp8266:nodemcuv2` passed with 262,676 bytes of flash
  code and 29,176 bytes of global RAM. COM12 upload passed flash verification.
  Truck 2 joined Quarks as `10.31.48.17`, returned HTTP 200 continuously, and
  appeared in the supervisor panel. It received zero GPS bytes, so no fix was
  verified.
- MAIN build `esp32:esp32:esp32` passed with 979,503 bytes of flash and 65,532
  bytes of global RAM. Upload passed and MAIN sent telemetry over USB and Wi-Fi.
  It received valid NMEA traffic but had no satellite fix. The HX711 produced
  live readings; the unloaded tare was saved as `-286025`, with net readings near
  zero. Kilograms remain disabled until a known reference mass is measured.
- Backend tests covered HTTP mode gating, both vehicle records surviving MAIN
  state replacement, GPS/load freshness, invalid numbers and uncalibrated values.
  Existing serial/live-runtime and firmware contract tests passed. Frontend
  build and supervisor view-model tests passed.
