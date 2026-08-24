# Demo

M0 demonstrates the repository foundation:

1. start the backend;
2. confirm `/api/health` returns `ok`;
3. start the frontend;
4. confirm the connection badge changes to `CONNECTED`;
5. watch the telemetry sequence, pose, speed, six ranges, and environment values update;
6. confirm every visible source label says `SIMULATED`.

Use the header control to switch between the driver and supervisor dashboards. The driver view keeps camera awareness, range proximity, speed, and route guidance prominent. The supervisor view shows the shared fleet map, conditions, sensor health, and alerts.

Obstacle, evaluated safe-corridor, emergency-stop, record, and replay steps are added in later milestones.
