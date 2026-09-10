# Mine-to-dump simulation

Run the normal backend and frontend commands from the README. The default
simulation is **Mine to dump**. Opening the dashboard without a view hash selects
Spatial after simulated telemetry connects. Explicit view links still work;
LIVE mode retains the driver view.

The continuous haul circuit follows a narrow, unmarked track through a conceptual
open-cast mine. A small rock appears on the outbound track. A valid front ToF
return enables the rock warning and a configured left-side detour. The rock stays
in place; it is not deleted to let the truck pass. Both opposing trucks reduce
speed during their encounter. A third truck ahead waits, then takes the service
road. The primary truck stops at the crusher to unload, returns to the loading
area, pauses to load, and starts another trip. Each encounter has distinct guidance.

The scenario toolbar is removed. The status header retains SIMULATED, including
on mobile. Existing simulation control endpoints remain available for testing.
Pausing through the API freezes travel and encounter timing for all vehicles.

The road, vehicle poses, obstacle and trip progress originate in backend
`WorldState`. The range provider raycasts the same obstacle and peer position
that the spatial scene and navigation map draw. Both peers publish simulated
V2V messages. No camera, radar or browser animation controls braking.

The navigation map is a local site plan with a blue route, heading markers,
obstruction marker, distance remaining, progress, zoom, drag and follow controls.
It works offline and uses no Google Maps services, imagery or API keys. This is
a fictional mine route in local metres, not a surveyed geographic location.
The supervisor starts with a WebGL mine scene and offers a flat plan view.
Pit benches, contours, the service spur and loading/unloading locations are
backend map features. TERRAIN features are cartography only, never sensed obstacles.
The pit exclusion polygon remains a real corridor hazard.

The supervisor's 2D plan uses a matching symbol key for vehicles, loading,
unloading, service facilities, road, pit benches and rock encounters. Labels keep
their screen size while zooming and use leader lines to avoid nearby labels.
The metric scale follows zoom; Local +Y indicates the Cartesian frame, not
surveyed north. The blue assigned route can be hidden without hiding the road.
The LIVE reference map keeps its own feature-based legend and remains separate
from the illustrative mine. No map geometry or telemetry is changed by styling.

This is a configured simulation controller, not Tesla autonomy or a general
obstacle planner. ToF confirms geometry, not rock classification. The simulator
knows the spawned object's identity and uses that identity for the rock label.
Real hardware keeps its existing sensor limits and deterministic stop controller.
The detour is configured for this track; this does not prove safe real-world passing.

Configuration is under `demo.haul` in `config/demo.yaml`. It owns route points,
road width, traffic position/speed, obstacle position/radius and encounter times.
Haul cruise speed is 1.8 m/s. Traffic and rock slowdowns retain a 1.15 m/s
base before their reduction factors. Corners blend over 1.8 m on each side,
limited by adjacent segment lengths, with continuous positions and headings.
The backend applies the same rounded route to the primary and opposing truck.
Waypoint distances and loading/unloading stops retain their route coordinates.
The previous Normal, Fog, Obstacle and Emergency scenarios retain the campus map.
Hardware providers and calibration are unchanged.

The detailed yellow truck mesh, steering, attitude, headlights, sensor effects
and three-layer ToF points are retained in Spatial. Additional instances use their own gradient
IDs and a scene offset. Road markings are absent in Spatial; blue route guidance
is confined to the navigation map. Road geometry is clipped before projection, and traffic
is sorted by camera depth. This remains a 2.5D scene; SVG face sorting is not a
full depth buffer and the illustrative truck dimensions are not a physical
vehicle collision envelope.

## Supervisor terrain

This scene is restricted to SIMULATED mode with an active haul route. LIVE and
REPLAY use the standard reference-map renderer, even if a snapshot contains haul
metadata. Mode switches unmount and dispose the illustrative scene.

The supervisor uses actual mesh geometry for illustrative elevation, stepped
pit benches, rock faces, the crusher hopper, conveyor, ore stockpile, maintenance
shed and excavator. Sparse vegetation is background context. Mine, truck and
crusher focus controls supplement orbit, zoom, pan and full-site framing.
The original truck surfaces are converted into one shared WebGL geometry. Truck
positions and headings still come from backend telemetry, with short visual
interpolation between received poses. No client-side route simulation is added.

Visual heights are derived from the backend road and bench polygons, not a
survey or a sensor height measurement. They never change the safety world state.
The reference image is not bundled. Material credits are in
`frontend/public/textures/mine/ATTRIBUTION.md`.

The renderer is loaded only for the 3D supervisor scene. It caps pixel ratio at
1.5 and its drawing buffer at two million pixels. Vegetation and rubble use
instanced geometry; textures are limited to two 1K material images plus small
procedural grain. It renders at up to 30 frames per second and cancels its frame
loop while hidden, offscreen or after WebGL context loss. It also sleeps once poses
and camera controls settle; new telemetry and interactions wake it. Shadow updates
follow incoming telemetry. Changing
views cancels animation frames, disconnects observers, removes labels and controls,
and disposes geometry, materials, textures, shadow maps and the WebGL context.
If WebGL is unavailable, an explicit message directs the operator to the 2D plan.

Browser checks after this addition observed one canvas in 3D and none after
switching to the 2D plan or Spatial. Returning to 3D retained 11 geometry resources
and four textures, including the shadow map. This checks scene remount behavior;
it does not establish long-duration memory stability or account for total browser RAM.

## Public Vercel demo

The Vercel deployment is a static, read-only demonstration, not a running Python
simulation server. During the build, `scripts/export_demo.py` runs the canonical
backend simulator through one haul cycle at 10 Hz and samples its WorldState at
5 Hz. The browser displays those samples at 10 Hz, so trucks, encounters and
loading/unloading play faster. Displayed speed values remain the recorded
simulation measurements, not doubled hardware readings. No browser route model,
collision controller or fabricated live telemetry is introduced. The mode stays
SIMULATED and the header explicitly identifies playback.

The current recording is 771 frames in 31 independently decodable chunks, about
3.43 MB gzip in total, plus a 26 KB manifest. One loop takes 77.1 seconds plus any
download delays. The reference map is downloaded once and retains object identity.
Each chunk starts with a full frame without the map; later frames replace changed
top-level fields. Integer timestamps are preserved and other numbers are rounded
to three decimal places. The backend's safety computation runs before rounding.
The interface shows SIMULATED and Demo, without a playback-speed label.

Chunks load only when reached. The player keeps at most 8 MiB of compressed data
and one decoded chunk, so repeat loops reuse downloads without retaining a whole
uncompressed recording. There is no background prefetch. Hiding the tab or using
Pause demo stops playback, cancels pending downloads and prevents new requests.
Returning resumes from the next frame, without trying to catch up. Failed downloads
retry with exponential backoff up to 30 seconds; the last valid scene remains on
screen with a Buffering demo label. Before the first frame, a loading/retry panel
appears instead of a misleading hardware-offline dashboard.

Vercel serves `frontend/dist` directly. `.vercelignore` excludes `api`, and the
Python framework entrypoint is removed, so the hosted demo does not deploy a
function. Hash-named chunks use immutable caching. Manifest/settings are revalidated.
There are no hosted telemetry sockets, camera streams or control writes. Display
calibration is tab-local; sending advisories and zeroing hardware require the local
backend. The regular `npm --prefix frontend run build` and local backend retain
LIVE/SIMULATED/REPLAY behavior and hardware controls. Local WebSocket clients also
disconnect when hidden and use bounded reconnect backoff.

Build and preview the public demo without running a backend:

```bash
python -m scripts.export_demo
```

```bash
npm --prefix frontend run build:demo
```

```bash
npm --prefix frontend run preview:demo
```

The Vercel build commands and output directory are in `vercel.json`. Redeploy this
revision to replace the previous function-backed deployment. Existing deployments
are not modified by local code changes. The hosted demo still consumes static
bandwidth, edge requests, build time and browser CPU/GPU. This reduces ongoing
usage, but cannot guarantee a monthly quota for an arbitrary number of visitors
or reset usage already incurred. Check Vercel's deployment output for zero Functions
and its Network/Usage panels after deployment.

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

Before the WebGL terrain addition, an interactive development check observed
roughly 43–53 MB of JavaScript heap
after warmup in a fresh tab, with one document and 340 event listeners across the
traffic and obstacle scenes. Backend private memory was about 537 MB. These are
short-run observations, not a long-duration leak guarantee. The reported 8 GB
was not reproduced or attributed to a specific FogSen process in this check.
