# Calibration

Calibration belongs in YAML under `config/`, not in sensor or mapping code.

`sensors.yaml` stores sensor position, orientation, servo limits, servo center, range offset, maximum range, stagger timing, and ArUco or IMU offsets. `vehicle.yaml` stores wheel geometry. `safety.yaml` stores clearance and stop thresholds.

Before a live run:

1. measure each sensor origin from the vehicle-frame center;
2. record orientation using positive X right and positive Y forward;
3. measure servo end stops without forcing the linkage;
4. measure ToF offset against known targets;
5. measure wheel circumference under vehicle load;
6. set the BMP280 startup baseline in stationary air;
7. validate every transform against a known point.

