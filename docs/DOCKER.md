# Run FogSen with Docker

The Compose stack runs two containers:

- `backend` runs FastAPI and the simulator on port 8000.
- `frontend` serves the built dashboard through nginx on port 8080. Nginx forwards `/api` and `/ws` to the backend, so the browser uses one origin for the dashboard and telemetry.

The stack does not build or flash firmware. It has no cloud dependency and stores no secrets.

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
- `http://127.0.0.1:8000/docs`

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
