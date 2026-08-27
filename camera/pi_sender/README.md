# FogSen Raspberry Pi camera sender

The Pi exposes one H.264 stream at `tcp://<pi-ip>:8888` over Wi-Fi. The laptop
decodes the stream, calculates visibility, and runs optional dehazing. The Pi
does not store recordings and the camera is never the sole braking input.

The current profile is 1296×972 at 30 FPS and 8 Mbit/s. Servos and controller
telemetry remain separate from this camera transport.
