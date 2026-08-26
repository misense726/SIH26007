from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections.abc import Sequence

from backend.app.models.telemetry import now_ms
from backend.app.providers.serial_port import MainControllerSerial
from backend.app.providers.serial_protocol import (
    MainTelemetryPacket,
    translate_main_packet,
)


COMMANDS = (
    "STATUS",
    "ZERO_ALT",
    "RESET_TICKS",
    "ESTOP_TEST",
    "ESTOP_RESET",
    "FRONT_CENTER",
    "REAR_CENTER",
    "FRONT_SCAN_ON",
    "FRONT_SCAN_OFF",
    "REAR_SCAN_ON",
    "REAR_SCAN_OFF",
)


def _arguments() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Read and validate FogSen MAIN telemetry over a USB cable."
    )
    parser.add_argument(
        "--port",
        default=os.getenv("FOGSEN_SERIAL_PORT"),
        help="MAIN serial port, such as COM5. Defaults to FOGSEN_SERIAL_PORT.",
    )
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument(
        "--send",
        action="append",
        choices=COMMANDS,
        default=[],
        help="Send a named firmware command after opening the port.",
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Print validated JSON instead of the compact status line.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Exit after the first valid telemetry packet.",
    )
    return parser


def format_main_packet(packet: MainTelemetryPacket, received_at_ms: int) -> str:
    sample = translate_main_packet(packet, received_at_ms)
    ranges = {reading.sensor_id: reading for reading in sample.ranges}
    speed = (
        f"{packet.wheel.speed:.3f}m/s" if bool(packet.wheel.enabled) else "DISABLED"
    )
    motor_cut = (
        str(int(sample.emergency.motor_cut))
        if bool(packet.estop.output_enabled)
        else "DISABLED"
    )

    def distance(sensor_id: str) -> str:
        reading = ranges[sensor_id]
        return f"{reading.range_m:.2f}m" if reading.is_valid else "UNKNOWN"

    return (
        f"MAIN {packet.ms}ms | "
        f"front {distance('front_scanner')}/{distance('front_fixed')} | "
        f"rear {distance('rear_scanner')}/{distance('left_side')}/"
        f"{distance('right_side')} | "
        f"speed {speed} | "
        f"{sample.emergency.state.value} cut={motor_cut}"
    )


def _print_available_ports() -> None:
    try:
        from serial.tools import list_ports
    except ImportError:
        print("pyserial is required: python -m pip install pyserial", file=sys.stderr)
        return
    ports = list(list_ports.comports())
    if not ports:
        print("No serial ports are currently visible.", file=sys.stderr)
        return
    print("Visible serial ports:", file=sys.stderr)
    for port in ports:
        print(f"  {port.device}: {port.description}", file=sys.stderr)


def main(argv: Sequence[str] | None = None) -> int:
    parser = _arguments()
    arguments = parser.parse_args(argv)
    if not arguments.port:
        _print_available_ports()
        parser.error("set --port COMx or FOGSEN_SERIAL_PORT")

    try:
        controller = MainControllerSerial(arguments.port, arguments.baud)
    except (OSError, RuntimeError) as exc:
        print(f"Could not open {arguments.port}: {exc}", file=sys.stderr)
        return 2

    previous_invalid = 0
    previous_discarded = 0
    try:
        for command in arguments.send:
            controller.send_command(command)
        while True:
            packets = controller.poll()
            for event in controller.drain_events():
                print(json.dumps(event, separators=(",", ":")))
            for packet in packets:
                if arguments.raw:
                    print(packet.model_dump_json(exclude_none=False))
                else:
                    print(format_main_packet(packet, now_ms()))
                if arguments.once:
                    return 0

            if (
                controller.invalid_packets != previous_invalid
                or controller.discarded_lines != previous_discarded
            ):
                print(
                    "serial warning: "
                    f"invalid={controller.invalid_packets} "
                    f"oversized={controller.discarded_lines}",
                    file=sys.stderr,
                )
                previous_invalid = controller.invalid_packets
                previous_discarded = controller.discarded_lines
            time.sleep(0.005)
    except KeyboardInterrupt:
        return 0
    finally:
        controller.close()


if __name__ == "__main__":
    raise SystemExit(main())
