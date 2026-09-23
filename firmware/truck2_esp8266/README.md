# Truck 2 Wi-Fi telemetry

This NodeMCU ESP8266 sketch sends GPS status directly to the MI Sense backend
over Wi-Fi. LoRa and the base station are no longer used.

GPS TX connects to D1, GPIO5. GPS RX is unconnected. Join grounds and power
the GPS at its breakout-rated voltage. Remove unused radio wires with power off.

Copy `wifi_secrets.example.h` to the Git-ignored `wifi_secrets.h` and configure
the network and backend URL. The local file has been configured for this PC.
The backend must run in LIVE mode. Open the supervisor's Truck GPS and load
panel to see DUMPER_02 connection and GPS status.

Build with the isolated CLI:

```powershell
& 'C:\Users\niran\.local\bin\arduino-cli.cmd' compile --warnings all --fqbn esp8266:esp8266:nodemcuv2 firmware/truck2_esp8266
```

Build and COM12 upload passed. Real Wi-Fi requests returned HTTP 200 and the
dashboard showed Truck 2 connected. GPS was still receiving zero bytes at the
time of testing, so coordinates remained unavailable.

See [wiring, protocol, calibration and results](../../docs/truck-wifi-gps-load.md).
