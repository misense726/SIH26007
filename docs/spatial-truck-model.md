# Spatial truck model

The spatial view uses a mining dumper model with an open steel hopper, reinforced
walls, a canopy, a glazed cab, access steps, mirrors, lamps and six round tires.
The rear axle has paired tires. Front tires steer with the existing steering
input, and the complete body follows the existing visual IMU attitude.

`frontend/src/spatial/truckMesh.ts` builds closed surfaces in the existing vehicle
display frame, with +X right, +Y forward and +Z up. Dimensions preserve the
dashboard footprint and are illustrative. Sensor positions and range calibration
still come from sensor settings.

`Vehicle3DTruck.tsx` projects these surfaces through the same camera as the sensor
overlays. It removes back-facing surfaces and sorts visible faces by camera depth.
Glass, tread grooves, grille slats and wheel bolts are drawn with their host face.
The mesh is cached until steering changes; projection is cached until attitude or
camera values change. The model uses no external assets or additional libraries.

The initial camera shows the cab and left side. Reset View restores that angle.
Direction labels follow the camera orbit. The existing sensor pods, hazard
perimeters and callsign remain overlays so their status stays readable. Missing
vehicle telemetry still hides the model. This visual update does not change the
2.5D ToF reconstruction or emergency-control logic.

Run `npm test` and `npm run build` from `frontend`. Geometry regressions cover
closed tires, outward normals, steering, invalid input and a full camera sweep.
Visually inspect front, rear, side, overhead and underside angles when changing
the mesh; the SVG renderer uses face depth sorting rather than a depth buffer.
