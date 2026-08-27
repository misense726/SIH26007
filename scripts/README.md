# Scripts

- `setup-firmware.ps1` installs the pinned ESP32 core and Arduino libraries.
- `verify-firmware.ps1` compiles all three controllers and runs the wired
  protocol contract tests.
- `start_live_fogsen.ps1` resolves the Pi on the current LAN, binds the API and
  MAIN Wi-Fi listener to all interfaces, and starts the raw-camera live runtime.
- `check_live_network.py` checks that MAIN telemetry is fresh, five range
  records are present, and the Pi camera is producing frames. Unknown ranges
  are reported as sensor state, not treated as a transport failure.

Run both scripts from the repository root. Upload commands remain explicit in
`firmware/README.md` so a guessed COM port cannot overwrite the wrong board.

For a live Wi-Fi run, start `start_live_fogsen.ps1` from the repository root,
then run `check_live_network.py` in another terminal. Pass `-PiHost` when the
Pi's mDNS name is unavailable.
