from __future__ import annotations

import math
from copy import deepcopy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import PROJECT_ROOT, RuntimeSettings, project_config
from backend.app.main import create_app
from backend.app.models import (
    CorridorState,
    DataMode,
    EmergencyLevel,
    MapFeatureType,
    SensorStatus,
    SimulationScenario,
    VisibilityState,
)
from backend.app.simulation.engine import FullSimulator
from backend.app.twin.route import PolylineRoute
from backend.app.twin.world_store import WorldStore


def simulator_config() -> dict:
    return deepcopy(project_config())


def observable_values(state) -> tuple:
    pose = state.primary_vehicle()
    return (
        round(pose.x_m, 6),
        round(pose.y_m, 6),
        round(pose.heading_deg, 6),
        round(pose.speed_mps, 6),
        tuple(
            (
                reading.sensor_id,
                round(reading.angle_deg, 6),
                round(reading.range_m, 6),
                round(reading.quality, 6),
            )
            for reading in state.ranges
        ),
        state.motion.left_hall_ticks,
        state.motion.right_hall_ticks,
        round(state.motion.imu_heading_deg, 6),
        state.motion.aruco_visible,
        round(state.environment.temperature_c, 6),
        round(state.environment.pressure_hpa, 6),
        round(state.environment.relative_altitude_m, 6),
        round(state.environment.visibility_score, 6),
        state.environment.visibility_state,
        state.safe_corridor.state,
        state.emergency.state,
        tuple((cell.column, cell.row, cell.hit_count) for cell in state.occupancy.occupied_cells),
    )


def test_simulation_control_api_is_typed_and_updates_the_shared_world() -> None:
    app = create_app(
        RuntimeSettings(config_dir=Path(PROJECT_ROOT / "config"), telemetry_hz=20)
    )
    with TestClient(app) as client:
        initial = client.get("/api/simulation")
        assert initial.status_code == 200
        assert initial.json()["scenario"] == "NORMAL"

        controlled = client.post(
            "/api/simulation/control",
            json={
                "reset": True,
                "scenario": "FOG",
                "running": False,
                "speed_scale": 0.65,
                "obstacle_enabled": False,
                "visibility_score": 0.2,
            },
        )
        assert controlled.status_code == 200
        assert controlled.json() == {
            "running": False,
            "scenario": "FOG",
            "speed_scale": 0.65,
            "obstacle_enabled": False,
            "visibility_score": 0.2,
            "front_scanner_angle_deg": -70.0,
            "rear_scanner_angle_deg": 70.0,
        }

        world = client.get("/api/world").json()
        assert world["mode"] == "SIMULATED"
        assert world["simulation"]["scenario"] == "FOG"
        assert world["vehicles"][0]["speed_mps"] == 0.0
        assert world["environment"]["visibility_score"] == pytest.approx(0.2)

        assert client.post(
            "/api/simulation/control", json={"speed_scale": 3.01}
        ).status_code == 422
        assert client.post(
            "/api/simulation/control", json={"scenario": "RANDOM"}
        ).status_code == 422
        assert client.post(
            "/api/simulation/control", json={"rogue_value": 99}
        ).status_code == 422


@pytest.mark.asyncio
async def test_normal_simulation_is_bounded_coherent_and_explicitly_simulated() -> None:
    config = simulator_config()
    simulator = FullSimulator(WorldStore(), config, telemetry_hz=10)
    await simulator.apply_control(reset=True, scenario=SimulationScenario.NORMAL)

    states = [await simulator.tick() for _ in range(12)]
    expected_ids = config["sensors"]["acquisition"]["sequence"]
    sensor_config = config["sensors"]["sensors"]
    previous_ticks = -1
    previous_y = 0.0

    for state in states:
        pose = state.primary_vehicle()
        assert state.mode is DataMode.SIMULATED
        assert pose.mode is DataMode.SIMULATED
        assert state.motion.mode is DataMode.SIMULATED
        assert state.camera.mode is DataMode.SIMULATED
        assert state.environment.mode is DataMode.SIMULATED
        assert state.simulation.scenario is SimulationScenario.NORMAL
        assert state.simulation.visibility_score == pytest.approx(0.88)

        assert [reading.sensor_id for reading in state.ranges] == expected_ids
        assert len(state.ranges) == 5
        timestamps = [reading.timestamp_ms for reading in state.ranges]
        assert all(
            later - earlier == config["sensors"]["acquisition"]["stagger_ms"]
            for earlier, later in zip(timestamps, timestamps[1:])
        )
        for reading in state.ranges:
            definition = sensor_config[reading.sensor_id]
            assert reading.mode is DataMode.SIMULATED
            assert reading.is_valid is True
            assert 0.02 <= reading.range_m <= definition["max_range_m"]
            assert reading.max_range_m == definition["max_range_m"]
            assert 0.7 <= reading.quality <= 1.0
            if "servo_min_deg" in definition:
                assert definition["servo_min_deg"] <= reading.angle_deg <= definition["servo_max_deg"]
            else:
                assert reading.angle_deg == 0.0

        assert 4.95 <= pose.x_m <= 5.05
        assert pose.y_m > previous_y
        assert pose.speed_mps == pytest.approx(1.15)
        assert pose.speed_mps <= config["vehicle"]["vehicle"]["max_demo_speed_mps"]
        assert pose.position_confidence >= 0.9
        previous_y = pose.y_m

        assert state.motion.left_hall_ticks >= previous_ticks
        assert state.motion.right_hall_ticks == state.motion.left_hall_ticks
        assert state.motion.left_distance_m == pytest.approx(state.motion.right_distance_m)
        assert state.motion.aruco_visible is True
        assert state.motion.provider_confidence == {
            "hall_odometry": 0.92,
            "imu": 0.93,
            "aruco": 0.96,
        }
        previous_ticks = state.motion.left_hall_ticks

        assert 25.5 <= state.environment.temperature_c <= 27.0
        assert 1006.0 <= state.environment.pressure_hpa <= 1009.0
        assert -0.5 <= state.environment.relative_altitude_m <= 0.5
        calculated_altitude = 44330.0 * (
            1.0 - (state.environment.pressure_hpa / 1007.8) ** (1.0 / 5.255)
        )
        assert state.environment.relative_altitude_m == pytest.approx(
            calculated_altitude, abs=0.01
        )
        assert state.environment.visibility_score == pytest.approx(0.88)
        assert state.environment.visibility_state is VisibilityState.GOOD

        assert state.camera.raw_available is True
        assert state.camera.raw_frame_id is not None
        assert 0.0 <= state.camera.metrics.contrast <= 1.0
        assert 0.0 <= state.camera.metrics.haze_proxy <= 1.0
        assert len(state.sensor_health) == 5
        assert all(health.status is SensorStatus.HEALTHY for health in state.sensor_health)
        assert all(health.detail == "SIMULATED range provider" for health in state.sensor_health)
        assert state.safe_corridor.state is CorridorState.GREEN
        assert state.safe_corridor.confidence >= 0.9
        assert state.radar_objects == []
        assert state.emergency.state is EmergencyLevel.SAFE

    assert [state.sequence for state in states] == list(range(1, 13))
    scanner_angles = [
        next(reading for reading in state.ranges if reading.sensor_id == "front_scanner").angle_deg
        for state in states
    ]
    assert scanner_angles == [-70, -60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40]


@pytest.mark.asyncio
async def test_same_controls_produce_the_same_values_across_multiple_ticks() -> None:
    first = FullSimulator(WorldStore(), simulator_config(), telemetry_hz=10)
    second = FullSimulator(WorldStore(), simulator_config(), telemetry_hz=10)
    await first.apply_control(reset=True, scenario=SimulationScenario.NORMAL)
    await second.apply_control(reset=True, scenario=SimulationScenario.NORMAL)

    first_values = [observable_values(await first.tick()) for _ in range(10)]
    second_values = [observable_values(await second.tick()) for _ in range(10)]

    assert second_values == first_values


@pytest.mark.asyncio
async def test_open_route_stops_at_destination_without_a_position_jump() -> None:
    config = simulator_config()
    simulator = FullSimulator(WorldStore(), config, telemetry_hz=10)
    await simulator.apply_control(reset=True, scenario=SimulationScenario.NORMAL)

    route_feature = simulator.reference_map.feature(MapFeatureType.ROUTE)
    assert route_feature is not None
    route = PolylineRoute(route_feature.points)
    route_speed_mps = float(config["demo"]["demo"]["route_speed_mps"])
    previous = route.sample(0.0)
    states = []
    ticks_to_destination = math.ceil(route.total_length_m / (route_speed_mps * 0.1))
    for _ in range(ticks_to_destination + 3):
        state = await simulator.tick()
        current = state.primary_vehicle()
        displacement_m = math.hypot(current.x_m - previous.x_m, current.y_m - previous.y_m)
        assert displacement_m <= route_speed_mps * 0.1 + 0.03
        previous = current
        states.append(state)

    destination = route.points[-1]
    final_pose = states[-1].primary_vehicle()
    assert final_pose.x_m == pytest.approx(destination.x_m, abs=0.02)
    assert final_pose.y_m == pytest.approx(destination.y_m, abs=0.02)
    assert final_pose.speed_mps == 0.0
    assert states[-1].motion.left_distance_m <= route.total_length_m + 0.06

    await simulator.apply_control(scenario=SimulationScenario.EMERGENCY)
    emergency_states = [await simulator.tick() for _ in range(8)]
    assert any(
        state.emergency.state is EmergencyLevel.EMERGENCY_STOP
        and state.emergency.motor_cut
        for state in emergency_states
    )


@pytest.mark.asyncio
async def test_scenarios_have_coherent_visibility_obstacle_and_emergency_behavior() -> None:
    simulator = FullSimulator(WorldStore(), simulator_config(), telemetry_hz=10)

    await simulator.apply_control(
        reset=True,
        scenario=SimulationScenario.FOG,
        running=False,
    )
    fog = await simulator.tick()
    assert fog.primary_vehicle().speed_mps == 0.0
    assert fog.environment.visibility_score == pytest.approx(0.18)
    assert fog.environment.visibility_state is VisibilityState.VERY_LOW
    assert fog.camera.metrics.haze_proxy > 0.6
    assert fog.radar_objects == []
    assert fog.emergency.state is EmergencyLevel.SAFE
    assert fog.safe_corridor.state is CorridorState.GREEN

    await simulator.apply_control(
        reset=True,
        scenario=SimulationScenario.EMERGENCY,
        running=True,
    )
    emergency_states = [await simulator.tick() for _ in range(12)]
    assert all(state.simulation.obstacle_enabled for state in emergency_states)
    assert all(
        radar.mode is DataMode.SIMULATED
        for state in emergency_states
        for radar in state.radar_objects
    )
    assert all(len(state.radar_objects) == 1 for state in emergency_states)
    assert any(state.safe_corridor.state is CorridorState.RED for state in emergency_states)
    assert any(
        state.emergency.state is EmergencyLevel.EMERGENCY_STOP
        and state.emergency.motor_cut
        for state in emergency_states
    )
    assert any(
        live_object.mode is DataMode.SIMULATED
        for state in emergency_states
        for live_object in state.live_objects
    )

    await simulator.apply_control(scenario=SimulationScenario.NORMAL)
    recovered = await simulator.tick()
    assert recovered.simulation.obstacle_enabled is False
    assert recovered.radar_objects == []
    assert recovered.emergency.state is EmergencyLevel.SAFE
    assert recovered.emergency.motor_cut is False
    assert recovered.safe_corridor.state is CorridorState.GREEN
