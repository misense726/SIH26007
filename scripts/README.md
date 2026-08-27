# Scripts

- `setup-firmware.ps1` installs the pinned ESP32 core and Arduino libraries.
- `verify-firmware.ps1` compiles all three controllers and runs the wired
  protocol contract tests.
- `start_live_fogsen.ps1` binds the API and MAIN Wi-Fi listener to all
  interfaces. It resolves and starts the Pi camera by default; `-NoCamera`
  starts a sensor-only runtime. The live telemetry target defaults to 20 Hz.
- `check_live_network.py` checks that MAIN telemetry is fresh, five range
  records are present, and the Pi camera is producing frames. Use
  `--skip-camera` for a sensor-only run. Unknown ranges are reported as sensor
  state, not treated as a transport failure.

Run both scripts from the repository root. Upload commands remain explicit in
`firmware/README.md` so a guessed COM port cannot overwrite the wrong board.

For a live Wi-Fi run, start `start_live_fogsen.ps1` from the repository root,
then run `check_live_network.py` in another terminal. Pass `-PiHost` when the
Pi's mDNS name is unavailable, or use `-NoCamera` while it is offline.
