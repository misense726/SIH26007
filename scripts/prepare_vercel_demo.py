"""Keep a prebuilt Vercel upload limited to the active SIMULATED recording."""

from __future__ import annotations

import json
from pathlib import Path
import re

from backend.app.config import PROJECT_ROOT


CHUNK_NAME = re.compile(r"[0-9a-f]{64}\.json\.gz\Z")


def prepare(dist: Path = PROJECT_ROOT / "frontend" / "dist") -> dict[str, int]:
    dist = dist.resolve()
    demo = dist / "demo"
    manifest = json.loads((demo / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("mode") != "SIMULATED" or manifest.get("scenario") != "HAUL":
        raise ValueError("The Vercel upload requires a SIMULATED haul recording")

    chunks = manifest.get("chunks")
    if not isinstance(chunks, list) or not chunks:
        raise ValueError("The demo manifest has no recording chunks")
    names = set()
    for chunk in chunks:
        url = chunk.get("url") if isinstance(chunk, dict) else None
        if not isinstance(url, str) or not url.startswith("/demo/"):
            raise ValueError("The demo manifest contains an invalid chunk URL")
        name = url.removeprefix("/demo/")
        if not CHUNK_NAME.fullmatch(name) or not (demo / name).is_file():
            raise ValueError(f"The demo chunk is missing or invalid: {url}")
        names.add(name)

    compressed_bytes = sum((demo / name).stat().st_size for name in names)
    if compressed_bytes != manifest.get("compressed_bytes"):
        raise ValueError("The recording size does not match its manifest")

    obsolete = [path for path in demo.glob("*.json.gz") if path.name not in names]
    for path in obsolete:
        path.unlink()

    # A direct upload of frontend/dist has no Python build or serverless route.
    # Carry over only the static cache headers from the source-deploy config.
    source_config = json.loads((PROJECT_ROOT / "vercel.json").read_text(encoding="utf-8"))
    (dist / "vercel.json").write_text(json.dumps({
        "$schema": "https://openapi.vercel.sh/vercel.json",
        "framework": None,
        "headers": source_config["headers"],
    }, indent=2) + "\n", encoding="utf-8")
    return {"chunks": len(names), "removed_old_chunks": len(obsolete), "compressed_bytes": compressed_bytes}


if __name__ == "__main__":
    print(json.dumps(prepare(), indent=2))
