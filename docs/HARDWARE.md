# Hardware

FogSen V1 uses one normal ESP32 as MAIN and two Seeed XIAO ESP32-C6 sensor
nodes. The two XIAOs collect two servo-scanned VL53L1X ranges and four fixed
VL53L0X ranges. MAIN reads the MPU6050, BMP280, and two Hall inputs, controls a
relay motor cut, and sends consolidated telemetry to the laptop over USB.

The controller links are wired UART at 115200 baud. No controller firmware uses
Wi-Fi, BLE, ESP-NOW, cloud services, or a wireless fallback. See
`firmware/README.md` for the pin map, power plan, flashing commands, polling
rates, and bench checklist.

Both servos require a separate regulated 5 V supply with common ground. The
relay output is an **Automatic Emergency Stop Simulation** that removes RC
motor power. It is not production braking, and it does not replace a physical
stop switch.

The firmware and laptop protocol compile and pass contract tests without
hardware attached. Relay polarity, Hall edge polarity, optical alignment,
servo limits, supply stability, and prolonged simultaneous operation still
require the assembled system.
