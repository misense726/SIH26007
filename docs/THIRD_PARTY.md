# Third-party components

## DehazeFormer-MCT

FogSen uses the DehazeFormer-MCT mixed-dataset checkpoint and model definition
from the author's [DehazeFormer demo](https://huggingface.co/spaces/IDKiro/DehazeFormer_Demo).
The Docker build pins revision `8e0b26c7732e2b0dc104f69c5ea30f913c878a89`
and verifies every downloaded file by SHA-256. The model is licensed under MIT;
its license is included in the backend image at `/opt/fogsen-model/LICENSE`.

Copyright © 2023 IDKiro.

## Leaflet

The driver and supervisor geographic views use
[Leaflet 1.9.4](https://leafletjs.com/). Leaflet is distributed under the BSD
2-Clause License. After `npm ci`, its license is available at
`frontend/node_modules/leaflet/LICENSE`.

## Online map tiles

The optional geographic views request road tiles from OpenStreetMap.

The browser loads these tiles from the providers at runtime. Provider
attribution is configured in `frontend/src/maps/campusConfig.ts`. These services
are external display dependencies and are subject to their availability and
usage terms. The backend schematic remains available without them.

## RGB-derived IR processing

The optional IR-style view uses OpenCV and, when CUDA is selected, PyTorch. It
uses no thermal model or thermal-camera dataset. The output is a false-color
transformation of the normal RGB frame.
