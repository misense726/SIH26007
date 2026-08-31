# MIDDLE ESP32-C3 Super Mini firmware brief

Target `esp32:esp32:nologo_esp32c3_super_mini` using Espressif Arduino core
3.3.11. This board definition enables USB CDC for the Super Mini USB connector.

MIDDLE owns two fixed VL53L0X V2 sensors:

- `left_side`, XSHUT GPIO0, runtime address `0x31`;
- `right_side`, XSHUT GPIO1, runtime address `0x32`.

Both sensors share GPIO4 SDA and GPIO5 SCL. Before starting or restarting Wire,
clear a stuck SDA line with at most 16 SCL pulses and a STOP condition. Read the
sensors sequentially with a 5 ms guard. At boot and recovery, hold both XSHUT
pins low, release one sensor, initialize it at `0x29`, assign and probe its
runtime address, then release the next sensor. Report failed or out-of-range
measurements as `-1`.

Use UART TX GPIO21 and RX GPIO20 at 115200 baud. MIDDLE sends:

```json
{"node":"MIDDLE","seq":43,"ms":18124,"left":440,"left_ms":18095,"right":510,"right_ms":18122,"ok":6}
```

Health bits remain globally stable. Fixed A is bit 1 and fixed B is bit 2, so a
healthy MIDDLE mask is `0x06`. MAIN combines these bits with its local rear
scanner and servo bits before publishing the existing `rear` laptop object.

Keep GPIO2, GPIO8, and GPIO9 free for boot behavior. Keep GPIO18 and GPIO19 free
for native USB. Use no wireless transport or software UART.
