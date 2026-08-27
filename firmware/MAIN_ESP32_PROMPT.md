# BACK/MAIN ESP32 firmware brief

Target `esp32:esp32:esp32` on an ESP32-WROOM DevKit. Read
`FIRMWARE_CONTEXT.md` first.

MAIN owns:

- rear VL53L1X scanner on GPIO13 XSHUT and GPIO14 SG90 PWM;
- shared local I2C on GPIO21/GPIO22 for rear scanner, MPU6050, and BMP280;
- FRONT UART on GPIO16 RX and GPIO17 TX;
- MIDDLE UART on GPIO26 RX and GPIO27 TX;
- reserved Hall inputs on GPIO32 and GPIO33, disabled and unconnected;
- reserved relay output on GPIO25, disabled and unconnected;
- laptop Wi-Fi telemetry, with USB retained as a diagnostic fallback.

Use 115200-baud hardware UART. FRONT sends `front.scan` and `front.front`.
MIDDLE sends `left` and `right` with healthy mask `0x06`. MAIN combines its
local rear scanner and servo bits with fresh MIDDLE bits to publish the existing
rear mask `0x0F`.

The rear scanner boots at `0x29`. Hold GPIO13 low, release it as input, assign
`0x30`, probe the address, and retry the reset and address sequence after a
failure. Report invalid or stale readings as `-1`.

Keep the rear scanner non-blocking. Sweep -80 through +80 degrees in 10-degree
steps with a 20 to 120 ms servo-settle bound. Serialize local I2C work in the
main loop so scanner, MPU6050, and BMP280 operations do not overlap.

Preserve exactly five laptop range fields:

- `front.scan`;
- `front.front`;
- `rear.scan`;
- `rear.left`;
- `rear.right`.

Preserve each range age and fail closed on missing, stale, malformed,
out-of-order, or unknown data. MAIN owns deterministic safety state. Keep Hall
and relay implementations compiled behind false profile flags. Disabled Hall
inputs contribute no odometry confidence, and disabled relay output never
drives GPIO25. Camera processing never controls a future relay.

Compile with warnings enabled. Report compile results separately from flashing,
sensor, servo, UART, and power tests. Hall and relay bench tests apply only to a
later enabled profile.
