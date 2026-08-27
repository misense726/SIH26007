# Demo

FogSen starts in a deterministic `NORMAL` simulation. The backend publishes the
same `WorldState` contract used by the wired live runtime. Both dashboards read
that shared state.

## Demo sequence

1. Start the backend and frontend.
2. Confirm `/api/health` returns `ok` and the dashboard says `CONNECTED`.
3. Open the driver view. Check that it shows `SIMULATED`, five ToF readings, the
   moving dumper, a green corridor, and 88 percent visibility. Use the theme
   control to check both light and dark modes.
4. Open the supervisor view. Confirm it shows the same vehicle pose, environment,
   sensor health, corridor, and alerts. Select each truck and switch between the
   backend schematic and road-map views.
5. Return to the driver view and expand the road map. Confirm that `DUMPER_01`
   follows the route near `V699+X9, Chennai` and that `DUMPER_02` starts on the
   west campus road within 100 metres.
6. In the supervisor V2X panel, inspect peers, advisories, and the packet log.
   A dispatch button adds an advisory to the in-memory simulation. It does not
   transmit over a DSRC or C-V2X radio.
7. Select `FOG`. Visibility becomes 18 percent and Auto adds the ToF spatial view
   over the camera panel. Use Camera or ToF overlay to override Auto, then return
   to Auto.
8. Select `OBSTACLE`. The simulator enables a fixed obstacle at the configured map
   position. ToF and simulated radar observations use the same obstacle geometry.
9. Select `EMERGENCY`. The simulator places a close obstacle ahead of the vehicle.
   Deterministic range and speed thresholds progress through the warning states and
   trigger the simulated motor cut. The stop remains latched until the scenario is
   cleared or the route is reset.
10. Select `NORMAL` to remove the obstacle, clear the motor cut, and return to the
   normal visibility preset.
11. Select `Reset route` to move the vehicle back to the start for another run.

The dashboard controls use these endpoints:

```text
GET  /api/simulation
POST /api/simulation/control
GET  /api/v2x/state
POST /api/v2x/messages/bsm
POST /api/v2x/broadcast-advisory
```

Example request:

```json
{
  "reset": true,
  "scenario": "FOG",
  "running": true,
  "speed_scale": 1.0,
  "visibility_score": 0.18
}
```

Fields are optional. A scenario loads its configured visibility and obstacle
preset first. Values supplied in the same request override that preset. The API
rejects visibility outside `0..1`, speed scale outside `0..3`, unknown scenarios,
and unknown fields.

## Data rules

- The route advances at 1.15 metres per second at normal speed and never exceeds
  the configured 2.5 metres per second demo limit. It stops at the destination
  instead of jumping back to the start.
- The simulator publishes exactly two scanning ToFs and three fixed ToFs. Each
  reading uses its configured angle, maximum range, quality, and staggered
  timestamp.
- Hall counts, IMU heading, and ArUco pose follow the same route motion. The ArUco
  dropout schedule is configured and repeatable.
- BMP280 values remain near the configured 26.2 degrees Celsius and 1007.8 hPa
  baselines. Relative altitude is derived from pressure and remains approximate.
- Camera metrics change with the selected visibility preset. No random-number
  source is used.
- Every generated telemetry model that has a mode field reports `SIMULATED`.

## Limits

This demo does not read physical sensors, stream a Pi camera, command a real relay,
or prove operation in mine fog. Simulated radar is not hardware radar. The camera
frame IDs and enhancement IDs are simulated metadata. BMP280 altitude is relative,
not precision positioning. The emergency output represents a prototype motor cut,
not production braking. V2X peers, RSUs, packet counts, RSSI, and 5.89 GHz channel
data are simulated. The IR-style camera view is derived from RGB luminance and is
not thermal imaging. OpenStreetMap tiles require internet access and do not alter
the canonical backend map.
