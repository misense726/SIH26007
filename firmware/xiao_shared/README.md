# FRONT XIAO shared firmware

`include/FogSenXiaoNode.h` contains the FRONT XIAO ESP32-C6 acquisition and
UART state machine. FRONT supplies its pins, addresses, and timing through
`front_xiao_esp32c6/node_config.h`.

FRONT uses D0 scanner XSHUT, D1 fixed-front XSHUT, D2 SG90 PWM, D4/D5 I2C, and
D6/D7 UART. Both ToFs share the local bus. The scanner becomes `0x30` and the
fixed-front sensor becomes `0x31` after the ordered XSHUT sequence.

The scanner sweeps -80 through +80 degrees. Firmware reads scanner then fixed
front with a 5 ms guard and reports `-1` for unknown range. Commands are
`PING`, `STATUS`, `CENTER`, `SCAN_ON`, `SCAN_OFF`, and `SETTLE=<ms>`. Settle is
bounded to 20 through 120 ms.

MIDDLE does not use this class. Its fixed-only C3 implementation lives in
`middle_esp32c3_supermini/MiddleFixedNode.h`. MAIN owns the rear scanner
locally.
