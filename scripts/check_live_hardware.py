from __future__ import annotations

import argparse
import time
from collections.abc import Sequence

from backend.app.providers.serial_port import MainControllerSerial


FRONT_SENSOR_MASK = 0x03
MIDDLE_SENSOR_MASK = 0x06
REAR_SENSOR_MASK = 0x01
FRESH_LIMIT_MS = 500


def _arguments() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Check the live five-ToF chain through the MAIN USB port."
    )
    parser.add_argument("--port", required=True, help="MAIN USB port, such as COM11")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--seconds", type=float, default=8.0)
    return parser


def _valid_range(value: object) -> bool:
    return isinstance(value, int) and value > 0


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _arguments().parse_args(argv)
    controller = MainControllerSerial(arguments.port, arguments.baud)
    packets: list[dict[str, object]] = []
    try:
        controller.send_command("STATUS")
        deadline = time.monotonic() + arguments.seconds
        while time.monotonic() < deadline:
            packets.extend(
                packet.model_dump(mode="json") for packet in controller.poll()
            )
            controller.drain_events()
            time.sleep(0.01)
    finally:
        invalid_lines = controller.invalid_packets
        oversized_lines = controller.discarded_lines
        controller.close()

    if not packets:
        print("FAIL MAIN: no valid telemetry packets")
        return 1

    front_packets = [packet["front"] for packet in packets]
    rear_packets = [packet["rear"] for packet in packets]
    front_sequences = {packet["seq"] for packet in front_packets}
    middle_sequences = {packet["seq"] for packet in rear_packets if packet["seq"]}

    checks = {
        "MAIN telemetry": len(packets) >= 2,
        "FRONT UART fresh": (
            len(front_sequences) >= 2
            and any(
                isinstance(packet["age"], int)
                and packet["age"] <= FRESH_LIMIT_MS
                for packet in front_packets
            )
        ),
        "FRONT scanner initialized": any(
            packet["ok"] & REAR_SENSOR_MASK for packet in front_packets
        ),
        "FRONT fixed initialized": any(
            packet["ok"] & (FRONT_SENSOR_MASK ^ REAR_SENSOR_MASK)
            for packet in front_packets
        ),
        "FRONT scanner range": any(
            _valid_range(packet["scan"]) for packet in front_packets
        ),
        "FRONT fixed range": any(
            _valid_range(packet["front"]) for packet in front_packets
        ),
        "REAR scanner initialized": any(
            packet["ok"] & REAR_SENSOR_MASK for packet in rear_packets
        ),
        "REAR scanner range": any(
            _valid_range(packet["scan"]) for packet in rear_packets
        ),
        "MIDDLE UART fresh": (
            len(middle_sequences) >= 2
            and any(
                isinstance(packet["age"], int)
                and packet["age"] <= FRESH_LIMIT_MS
                for packet in rear_packets
            )
        ),
        "MIDDLE sensors initialized": any(
            packet["ok"] & MIDDLE_SENSOR_MASK == MIDDLE_SENSOR_MASK
            for packet in rear_packets
        ),
        "LEFT range": any(_valid_range(packet["left"]) for packet in rear_packets),
        "RIGHT range": any(
            _valid_range(packet["right"]) for packet in rear_packets
        ),
    }

    for name, passed in checks.items():
        print(f"{'PASS' if passed else 'FAIL'} {name}")
    print(
        f"INFO packets={len(packets)} invalid_lines={invalid_lines} "
        f"oversized_lines={oversized_lines}"
    )

    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
