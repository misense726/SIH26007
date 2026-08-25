from __future__ import annotations

from backend.app.models import (
    DataMode,
    LiveObject,
    LiveObjectType,
    RangeReading,
    SensorHealth,
    SensorStatus,
    SpatialPoint,
    VehiclePose,
)
from backend.app.perception.change_detection import ChangeDetector
from backend.app.safety.corridor import CorridorEvaluator
from backend.app.safety.emergency import EmergencyController, SafetyParameters
from backend.app.twin.map_store import load_reference_map


def safety_parameters() -> SafetyParameters:
    return SafetyParameters(
        warning_time_s=2.0,
        critical_time_s=1.0,
        emergency_time_s=0.5,
        stationary_warning_m=0.8,
        stationary_critical_m=0.45,
        stationary_emergency_m=0.2,
        reaction_time_s=0.5,
        braking_deceleration_mps2=2.0,
        confidence_floor=0.5,
        stale_sensor_ms=500,
        emergency_persistence_ms=300,
    )


def test_change_detector_finds_repeated_unknown_road_points() -> None:
    reference_map = load_reference_map("maps/test_route.json")
    detector = ChangeDetector(reference_map)
    points = [
        SpatialPoint(x_m=5.1, y_m=4.1, source_sensor_id="front", timestamp_ms=1000),
        SpatialPoint(x_m=5.2, y_m=4.2, source_sensor_id="front", timestamp_ms=1100),
        SpatialPoint(x_m=5.15, y_m=4.1, source_sensor_id="front", timestamp_ms=1200),
    ]
    objects = detector.detect(
        points,
        VehiclePose(x_m=5, y_m=2),
        timestamp_ms=1300,
        mode=DataMode.SIMULATED,
    )
    assert any(item.object_type is LiveObjectType.UNKNOWN_OBSTACLE for item in objects)


def test_corridor_is_green_with_confident_sensors_and_no_obstacle() -> None:
    reference_map = load_reference_map("maps/test_route.json")
    evaluator = CorridorEvaluator(reference_map, 0.35, 0.45, 0.55)
    health = [SensorHealth(sensor_id=f"sensor-{index}") for index in range(6)]
    corridor = evaluator.evaluate(
        pose=VehiclePose(x_m=5, y_m=2, position_confidence=0.95),
        live_objects=[],
        sensor_health=health,
        nearest_obstacle_m=3.0,
        warning_distance_m=1.5,
        critical_distance_m=0.8,
    )
    assert corridor.state == "GREEN"
    assert corridor.polygon


def test_corridor_treats_stale_sensor_as_unknown() -> None:
    reference_map = load_reference_map("maps/test_route.json")
    evaluator = CorridorEvaluator(reference_map, 0.35, 0.45, 0.55)
    health = [SensorHealth(sensor_id="front", status=SensorStatus.STALE, confidence=0.4)]
    corridor = evaluator.evaluate(
        VehiclePose(x_m=5, y_m=2), [], health, None, 1.5, 0.8
    )
    assert corridor.state == "GREY"


def test_close_live_obstacle_makes_corridor_red() -> None:
    reference_map = load_reference_map("maps/test_route.json")
    evaluator = CorridorEvaluator(reference_map, 0.35, 0.45, 0.55)
    obstacle = LiveObject(
        object_id="obstacle",
        x_m=5,
        y_m=2.5,
        object_type=LiveObjectType.UNKNOWN_OBSTACLE,
    )
    corridor = evaluator.evaluate(
        VehiclePose(x_m=5, y_m=2),
        [obstacle],
        [SensorHealth(sensor_id="front")],
        0.5,
        1.5,
        0.8,
    )
    assert corridor.state == "RED"


def test_emergency_stop_requires_persistent_deterministic_range() -> None:
    controller = EmergencyController(safety_parameters())
    reading = RangeReading(
        timestamp_ms=1000,
        sensor_id="front_scanner",
        range_m=0.15,
        quality=1.0,
    )
    first = controller.evaluate(1000, 0.2, [reading])
    second = controller.evaluate(
        1400,
        0.2,
        [reading.model_copy(update={"timestamp_ms": 1400})],
    )
    assert first.state == "CRITICAL"
    assert second.state == "EMERGENCY_STOP"
    assert second.motor_cut is True

    clear_reading = reading.model_copy(
        update={"timestamp_ms": 1500, "range_m": reading.max_range_m}
    )
    still_latched = controller.evaluate(1500, 0.0, [clear_reading])
    assert still_latched.state == "EMERGENCY_STOP"
    assert still_latched.motor_cut is True

    controller.reset()
    cleared = controller.evaluate(1600, 0.0, [clear_reading])
    assert cleared.state == "SAFE"
    assert cleared.motor_cut is False


def test_missing_front_range_is_not_reported_safe() -> None:
    controller = EmergencyController(safety_parameters())
    state = controller.evaluate(1000, 1.0, [])
    assert state.state == "WARNING"
    assert state.confidence == 0.0
