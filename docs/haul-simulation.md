# Mine-to-dump simulation

Run the normal backend and frontend commands from the README. The default
simulation is **Mine to dump**. Opening the dashboard without a view hash selects
Spatial after simulated telemetry connects. Explicit view links still work;
LIVE mode retains the driver view.

The continuous haul circuit follows a narrow, unmarked track through a conceptual
open-cast mine. Trucks start at the pit floor, climb the graded access road,
complete the crusher circuit and descend to load again. The access road is part
of the backend route and usable road geometry, with the surrounding pit excluded.
The fleet contains eight dumpers. Each queues at the pit floor, loads iron ore,
climbs to the crusher, waits for the tipping bay, reverses into it, raises its bed,
empties the load, lowers the bed and returns empty. The loading bay and tipping
bay each admit one truck at a time. Trucks slow for tight bends. Two excavators
stand on the pit floor; there are no decorative dumpers on the upper benches.

The backend publishes each truck's phase, cargo fraction, bed angle and road
elevation. The renderer uses that road grade for chassis pitch and keeps roll
level. It does not sample nearby cliff faces for truck attitude or run a separate
tipping timer. Pausing freezes travel, cargo transfer and tipping for every truck.
The crusher has a fully roofed receiving hall with corrugated walls and a wide
road-facing portal. Trucks reverse along a backend-owned curve into an off-road
bay, stop with their rear wheels on the apron, and tip directly into the recessed
pocket. Dock coordinates anchor the building, terrain cut and ore stream. A
processing tower and covered conveyor connect to the lower stockyard.

The header retains SIMULATED. Existing simulation control endpoints remain
available. The previous rock, opposing-traffic and service-road encounters can
still be run with `demo.haul.production_cycle: false`. Those encounters use the
original rim route. The ore cycle uses backend spacing and bay queues; its fleet
traffic is not injected into the prototype 2D ToF raycast. V2X still publishes all
seven peers. Hardware providers and their deterministic stop logic are unchanged.

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
Haul cruise speed is 1.9 m/s before the SIMULATED speed scale, capped at
2.8 m/s in the local demo. Traffic and rock slowdowns retain a 1.15 m/s
base before their reduction factors. The floor rock has a configured detour.
Additional scripted rocks sit along the road shoulder at roughly 100 m
intervals so the Spatial view presents another rock encounter about every
40 seconds while trucks are travelling. The crusher and loading bay create
longer gaps. These rocks are illustrative SIMULATED hazards; they do not
change live ToF or automatic stop logic. Corners blend over 1.8 m on each side,
limited by adjacent segment lengths, with continuous positions and headings.
Every truck follows the same graded circuit. Loading, reversing, tipping and
lowering durations, queue spacing and the turn-rate limit are configured alongside
the route. A staging-lane offset separates the loading queue from departing
trucks, and paired crossing sections admit one direction at a time while
same-direction trucks keep their queue spacing. Both sides of the crossing
share one reservation so opposing trucks cannot wait on each other. The
full-cycle footprint check samples all eight trucks and finds no intersections.
The legacy encounter demo retains its opposing truck.
Waypoint distances and loading/unloading stops retain their route coordinates.
The previous Normal, Fog, Obstacle and Emergency scenarios retain the campus map.
Hardware providers and calibration are unchanged.

Spatial uses the WebGL point-cloud renderer adapted from Claude's `d70c1fb`
implementation. In SIMULATED mode, it samples the graded mine terrain around the
backend vehicle pose. Dense, world-anchored points follow the road grade and
ordered side-wall bands. Distance sets their colour: near returns red, distant
returns blue. The short green mark ahead indicates the truck's forward path.
The configured floor rock is bright red, and backend fleet poses follow a
smooth detour around it. Later shoulder rocks appear as the route approaches;
the fleet stays in its lane. Nearby trucks first appear as blue scan points, then
resolve into correctly sized 3D truck bodies. The moving vehicle stays solid.
Terrain, rocks and truck surfaces are illustrative scene geometry, labelled
SIMULATED MAPPING and kept separate from measured ToF returns and safety
decisions. The simulated warning panel names a rock or truck only when it is
inside the forward corridor; it does not treat roadside berm returns as a
classified obstacle. Encounter banners remain briefly visible after passing,
with wording that no longer claims the object is ahead. The displayed route
level is relative to the fictional mine datum, not surveyed altitude.
The supervisor retains its mine scene and backend-driven loading and tipping animations.
Background forest density and shadow refresh are limited so the mine remains
legible and the browser has less work per frame.
LIVE uses calibrated, planar ToF points. If both modes lack usable surroundings,
Spatial displays a labelled SIMULATED PREVIEW, exported by the backend's
`simulation/spatial_preview.py`. That visual fixture never enters WorldState,
localization or emergency logic. REPLAY never substitutes this preview.

## Simulated haul analytics

The SIMULATED runtime starts with 15 completed illustrative trips for each of
DUMPER_01 through DUMPER_08, 120 records in total. Every trip carries
`source: "SIMULATED"`. A deterministic seed varies payload, loaded and empty
travel distance, loading and dumping time, queuing and fuel consumption. Each
truck's first 15 efficiencies remain distinct when displayed to two decimals.
The numerical values and IDs repeat across runs; timestamps anchor once to
simulator startup. Reset restores that same startup history.

Nominal capacities for trucks 01 through 08 are 100, 95, 105, 90, 100, 95, 105
and 90 tonnes. A truck receives a new 80-99% capacity target once per cycle.
Its visible cargo fraction rises to that target during loading, stays fixed
while hauling, and falls during tipping. `haul.payload_target_tonnes` is the
cycle target; `haul.payload_capacity_tonnes` and the existing operational
`target_payload_tonnes` are rated capacity. Current tonnes are published in
both `haul.payload_tonnes` and the operational fleet metadata.

The default HAUL controller records one trip when each truck completes its
empty return, including the primary dumper. It sums the controller's actual
travel distances and phase durations and uses the completed cycle's fixed
payload target, not its now-empty bed. Fuel is an estimate based on loaded and
empty distance, payload, travel speed, hydraulic handling and stopped queue
time. The formula is documented in `backend/app/analytics/simulated_haul.py`.
It is not a calibrated sensor or manufacturer fuel specification. Startup
trips represent illustrative mine hauls; ongoing trips follow the smaller,
accelerated demo circuit. Operator pauses freeze the simulated cycle clock.
An emergency motor cut instead counts as stopped idle time and estimated idle
fuel while the simulation remains running; primary emergency status is preserved
in both world fleet metadata and the fleet API.
Selecting HAUL again retains completed history and resumes the next load
ordinal; an explicit reset discards runtime completions and partial cycles.

`GET /api/analytics/trip-history?vehicle_id=DUMPER_01&limit=15` returns newest
first. `vehicle_id` is optional and `limit` is 1 through 200. Filtering happens
before limiting. `total_trips` and `total_tonnes` cover all retained matching
records, not just the returned page. Fleet metrics and vehicle totals use the
same retained history, not lifetime shift counters. History is bounded at 200
records and keeps at least 15 per truck by evicting older excess records from
busier trucks first. An unknown vehicle returns an empty history.

LIVE still starts with `seed_baseline=False`, never constructs this haul
controller, and never pads missing measurements with generated records.
Records without known provenance retain a null source. REPLAY does not run
load generation. These changes do not add live payload or fuel sensors.

Static demo builds include `/demo/trip-history.json` and
`/demo/haulage-metrics.json`, using the same startup records and API response
shapes. They are fixed demonstration history, not extra cycles generated by
browser playback. Refresh only these small files without rebuilding world
chunks or terrain with `python -m scripts.export_demo --analytics-only`.

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
simulation server. Before the build, `scripts/export_demo.py` runs the canonical
backend simulator through one haul cycle at 5 Hz and records each WorldState.
The browser displays those samples at 10 Hz, so trucks, encounters and
loading/unloading play faster. Displayed speed values remain the recorded
simulation measurements, not doubled hardware readings. No browser route model,
collision controller or fabricated live telemetry is introduced. The mode stays
SIMULATED and the header explicitly identifies playback.

The manifest reports the generated frame count, duration and chunks. The longer
pit-floor circuit takes more playback time than the previous rim-only recording.
The reference map is downloaded once and retains object identity.
Each chunk starts with a full frame without the map; later frames replace changed
top-level fields. Integer timestamps are preserved and other numbers are rounded
to three decimal places. The backend's safety computation runs before rounding.
The interface shows SIMULATED and Demo, without a playback-speed label.

Chunks load only when reached. The player keeps at most 20 MiB of compressed data
and one decoded chunk, so repeat loops reuse downloads without retaining a whole
uncompressed recording. There is no background prefetch. Hiding the tab or using
Pause demo stops playback, cancels pending downloads and prevents new requests.
Returning resumes from the next frame, without trying to catch up. Failed downloads
retry with exponential backoff up to 30 seconds; the last valid scene remains on
screen with a Buffering demo label. Before the first frame, a loading/retry panel
appears instead of a misleading hardware-offline dashboard.

Vercel serves a locally prepared `frontend/dist` directly. The upload contains no
Python backend or function. Hash-named chunks use immutable caching.
Manifest/settings are revalidated.
There are no hosted telemetry sockets, camera streams or control writes. Display
calibration is tab-local; sending advisories and zeroing hardware require the local
backend. The regular `npm --prefix frontend run build` and local backend retain
LIVE/SIMULATED/REPLAY behavior and hardware controls. Local WebSocket clients also
disconnect when hidden and use bounded reconnect backoff.
The public Driver view reads guidance from each recorded WorldState rather than
polling a nonexistent API. Static analytics read the recorded JSON fixtures once.

Build and preview the public demo without running a backend:

```bash
python -m scripts.export_demo
```

```bash
npm --prefix frontend run build:demo
```

```bash
python -m scripts.prepare_vercel_demo
```

```bash
npm --prefix frontend run preview:demo
```

Deploy `frontend/dist` from the CLI to upload the prepared static files without
running the Python export or npm build on Vercel. The preparation step removes
chunks that are not referenced by the current manifest from the generated build;
the local source recording is retained. The root `vercel.json` still describes a
source build and must not be used for the low-build-cost production upload. The
hosted demo still consumes CDN requests, data transfer and browser CPU/GPU.
Check the deployment for zero Functions and review usage in Vercel.
The recorded playback keeps the eight most recent V2X messages per frame; live
telemetry retains its normal history limit. The current compressed recording is
about 8.3 MB, below the previous 15.4 MB recording.

## Efficiency checks

The WebSocket route now requests an encoded revision from `WorldStore`. The
store serializes once per published revision and shares it across clients. Polls
of unchanged state no longer deep-copy the full point map. The simulator reads
the sequence without copying the previous world. Synthetic camera metrics are
recomputed only when their input visibility target changes.

The client retains one reference-map object while its contents are unchanged.
The spatial renderer reuses GPU buffers and pauses rendering while hidden.
Measured returns use a 240-point display budget shared between sensor sources.
Repeated observations retain their newest sample in each 4 cm world cell;
the displayed coordinates remain the measured positions. Navigation resize
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
