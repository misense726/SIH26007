# Scripts

- `setup-firmware.ps1` installs the pinned ESP32 core and Arduino libraries.
- `verify-firmware.ps1` compiles all three controllers and runs the wired
  protocol contract tests.

Run both scripts from the repository root. Upload commands remain explicit in
`firmware/README.md` so a guessed COM port cannot overwrite the wrong board.
