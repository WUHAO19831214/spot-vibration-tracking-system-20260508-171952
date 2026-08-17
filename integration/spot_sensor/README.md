# `tracker.spot-centroid` downstream integration

This is an **offline replay integration seam**, not a replacement for the browser camera loop. The existing `app.js` remains the default teaching application and its algorithm is retained unchanged.

## Pinned public dependency

`../requirements-v0.6.0.txt` installs the wheel published on the immutable [Physics Software Sensors v0.6.0 release](https://github.com/WUHAO19831214/physics-software-sensors/releases/tag/v0.6.0), with its SHA-256 pinned in the URL. The package version inside that release is `0.5.0`; the selected Sensor implementation is `tracker.spot-centroid@0.4.0`.

```bash
python3.12 -m venv .venv-physics-sensors
.venv-physics-sensors/bin/python -m pip install -r integration/requirements-v0.6.0.txt
```

## Feature flag and rollback

The replay adapter defaults to the legacy project algorithm. Select a backend with either the CLI or `SPOT_SENSOR_BACKEND`:

```bash
.venv-physics-sensors/bin/python integration/spot_sensor/runner.py --backend legacy
.venv-physics-sensors/bin/python integration/spot_sensor/runner.py --backend library
.venv-physics-sensors/bin/python integration/spot_sensor/runner.py --backend compare --output integration/spot_sensor/results/comparison.json
SPOT_SENSOR_BACKEND=legacy .venv-physics-sensors/bin/python integration/spot_sensor/runner.py
```

Rollback is immediate: leave the flag unset or set it to `legacy`. Removing the optional integration environment does not alter `index.html`, `app.js`, browser camera permissions, calibration, sweep logic, or the published application.

## Evidence boundary

The same generated BGR arrays are passed to the project-side legacy reference and the released library. Cases cover normal lock, horizontal/vertical movement, lower intensity, blank/lost, ROI-edge geometry, overexposure, and a three-frame derived displacement sequence. The comparison checks lock state, centroid, radius, weight sum, and the downstream `y_max-y_min` pixel/cm calculation.

The fixture definitions are deterministic and owned by this project, but **synthetic**. This validates downstream reuse and rollback mechanics; it is not real-camera, controlled-physics, accuracy, calibration, or uncertainty evidence. The realtime browser-to-Python bridge is intentionally deferred.

## Test

```bash
.venv-physics-sensors/bin/python -m unittest discover -s integration/spot_sensor -p 'test_*.py' -v
node --check app.js
python3 -m http.server 4173
```

The last two checks preserve the original browser application smoke path. See [integration design](../../docs/PHYSICS_SENSORS_INTEGRATION.md).
