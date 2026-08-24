# Hardware

FogSen V1 targets two servo-scanned VL53L1X sensors, four fixed VL53L0X sensors, an MPU6050, two Hall wheel sensors, a BMP280, an overhead ArUco camera, a Raspberry Pi camera, an ESP32, and a relay that cuts RC motor power.

No live hardware is connected in M0. The code labels every sample `SIMULATED` and exposes provider interfaces for later USB serial and camera integration.

The physical motor output will be described as an **Automatic Emergency Stop Simulation**. Removing RC motor power is not production braking.

