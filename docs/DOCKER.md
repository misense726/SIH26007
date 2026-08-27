# Run FogSen with Docker

The Compose stack runs two containers:

- `backend` runs FastAPI and the simulator on port 8000.
- `frontend` serves the built dashboard through nginx on port 8080. Nginx forwards `/api` and `/ws` to the backend, so the browser uses one origin for the dashboard and telemetry.

The backend opens the Raspberry Pi H.264 listener over Wi-Fi, shares decoded
frames through `/api/camera/stream`, and runs DehazeFormer-MCT on the laptop GPU.
An optional second worker creates an RGB-derived IR-style view on the CPU or
GPU. It does not use USB video or USB-LAN. MAIN sends dashboard telemetry over
Wi-Fi to TCP port `8765`. USB remains available for uploads and diagnostics.

The stack does not build or flash firmware and stores no secrets. The backend
runtime and schematic map have no cloud dependency. The backend image build
fetches a pinned, checksum-verified MIT-licensed DehazeFormer model from the
author's repository.
Set `FOGSEN_MODE=LIVE` and `FOGSEN_TELEMETRY_TRANSPORT=WIFI` before starting
Compose to run the network listener in the backend container. The default mode
remains `SIMULATED`.

Docker Desktop must expose the NVIDIA runtime for GPU dehazing. Check it with
`docker info` if the backend reports that CUDA is unavailable. Raw video remains
available even when the ML worker fails.

The core simulator and schematic map work without internet access. Leaflet
satellite, dark, and street layers are requested directly by the browser from
Esri or OpenStreetMap. They are optional presentation layers and do not affect
the backend twin or safety state.

## Start the stack

Run these commands from the repository root in Command Prompt:

```bat
docker compose config
docker compose build
docker compose up -d --wait
docker compose ps
```

Open `http://127.0.0.1:8080`.

Backend endpoints remain available directly at:

- `http://127.0.0.1:8000/api/health`
- `http://127.0.0.1:8000/api/status`
- `http://127.0.0.1:8000/api/world`
- `http://127.0.0.1:8000/api/camera/status`
- `http://127.0.0.1:8000/api/camera/frame?view=raw`
- `http://127.0.0.1:8000/api/camera/frame?view=enhanced`
- `http://127.0.0.1:8000/api/camera/frame?view=ir`
- `http://127.0.0.1:8000/api/v2x/state`
- `http://127.0.0.1:8000/docs`

The default Pi source is `tcp://10.38.143.254:8888`. Set
`FOGSEN_CAMERA_STREAM_URL` in `.env` if its Wi-Fi address changes. Set
`FOGSEN_CAMERA_DEHAZE_ENABLED=false` to run raw video without the model.
Set `FOGSEN_CAMERA_IR_ENABLED=false` to disable the false-color IR worker.
`FOGSEN_CAMERA_IR_DEVICE`, `FOGSEN_CAMERA_IR_FP16`,
`FOGSEN_CAMERA_IR_MAX_FPS`, and `FOGSEN_CAMERA_IR_COLORMAP` control that worker.
The IR view is derived from the RGB camera and is not thermal data.

Check logs if a service does not become healthy:

```bat
docker compose logs --tail=200 backend frontend
```

Stop the stack without deleting the images:

```bat
docker compose down
```

Rebuild after changing Python or frontend source:

```bat
docker compose up -d --build --wait
```
