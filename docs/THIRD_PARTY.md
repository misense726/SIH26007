# Third-party components

## DehazeFormer-MCT

FogSen uses the DehazeFormer-MCT mixed-dataset checkpoint and model definition
from the author's [DehazeFormer demo](https://huggingface.co/spaces/IDKiro/DehazeFormer_Demo).
The Docker build pins revision `8e0b26c7732e2b0dc104f69c5ea30f913c878a89`
and verifies every downloaded file by SHA-256. The model is licensed under MIT;
its license is included in the backend image at `/opt/fogsen-model/LICENSE`.

Copyright © 2023 IDKiro.
