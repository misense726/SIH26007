from __future__ import annotations

import json
from pathlib import Path

from backend.app.config import PROJECT_ROOT
from backend.app.models import ReferenceMap


def project_path(path: str | Path) -> Path:
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = PROJECT_ROOT / candidate
    return candidate.resolve()


def load_reference_map(path: str | Path) -> ReferenceMap:
    resolved = project_path(path)
    with resolved.open("r", encoding="utf-8") as handle:
        return ReferenceMap.model_validate(json.load(handle))


def save_reference_map(reference_map: ReferenceMap, path: str | Path) -> Path:
    resolved = project_path(path)
    resolved.parent.mkdir(parents=True, exist_ok=True)
    temporary = resolved.with_suffix(f"{resolved.suffix}.tmp")
    temporary.write_text(
        reference_map.model_dump_json(indent=2),
        encoding="utf-8",
        newline="\n",
    )
    temporary.replace(resolved)
    return resolved

