# Mine-to-dump simulation

Run the normal backend and frontend commands from the README. The default
simulation is **Mine to dump**. Opening the dashboard without a view hash selects
Spatial after simulated telemetry connects. Explicit view links still work;
LIVE mode retains the driver view.

The truck leaves the mine loading bay, passes an oncoming dumper, encounters a
road obstruction, and reaches the dump point. The obstruction appears after
12 simulation seconds. Deterministic ToF range logic stops the truck. After six
seconds stopped, the simulation clears the obstruction and resets its simulated
stop output. The truck resumes and stops at the destination. **Reset route**
restarts the run. **Pause** freezes travel and encounter timing for both vehicles.

The road, vehicle poses, obstacle and trip progress originate in backend
`WorldState`. The range provider raycasts the same obstacle and peer position
that the spatial scene and navigation map draw. The peer also publishes simulated
V2V messages. No camera, radar or browser animation controls braking.

The navigation map is a local site plan with a blue route, heading markers,
obstruction marker, distance remaining, progress, zoom, drag and follow controls.
It works offline and uses no Google Maps services, imagery or API keys. This is
a fictional mine route in local metres, not a surveyed geographic location.

Configuration is under `demo.haul` in `config/demo.yaml`. It owns route points,
road width, traffic position/speed, obstacle position/radius and encounter times.
The previous Normal, Fog, Obstacle and Emergency scenarios retain the campus map.
Hardware providers and calibration are unchanged.

The detailed yellow truck mesh, steering, attitude, headlights, sensor effects
and three-layer ToF points are retained. A second instance uses its own gradient
IDs and a scene offset. Road geometry is clipped before projection, and traffic
is sorted by camera depth. This remains a 2.5D scene; SVG face sorting is not a
full depth buffer and the illustrative truck dimensions are not a physical
vehicle collision envelope.

## Efficiency checks

The WebSocket route now requests an encoded revision from `WorldStore`. The
store serializes once per published revision and shares it across clients. Polls
of unchanged state no longer deep-copy the full point map. The simulator reads
the sequence without copying the previous world. Synthetic camera metrics are
recomputed only when their input visibility target changes.

The client retains one reference-map object while its contents are unchanged.
The spatial grid is memoized, point slots have stable DOM identities, and the
cloud blur is bounded to the viewport. These changes retain the 220-point display
limit, all three height layers, animations and telemetry rate. Navigation resize
observers disconnect on unmount. Backend buffers retain their existing limits:
900 accumulated points, 600 transmitted points, 420 occupancy cells, 60 alerts
and 50 V2X log entries.

Run the repeated-read benchmark from the repository root:

```powershell
python -m scripts.benchmark_telemetry
python -m pytest
npm --prefix frontend test
npm --prefix frontend run build
```

An interactive development check observed roughly 43–53 MB of JavaScript heap
after warmup in a fresh tab, with one document and 340 event listeners across the
traffic and obstacle scenes. Backend private memory was about 537 MB. These are
short-run observations, not a long-duration leak guarantee. The reported 8 GB
was not reproduced or attributed to a specific FogSen process in this check.
