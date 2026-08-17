# Physics Software Sensors integration

## Decision

This project adopts `tracker.spot-centroid` from `WUHAO19831214/physics-software-sensors` through a project-local offline replay adapter. The source baseline is this repository at commit `7f0d91cc73afafaecc54acc46b2b9d69375d994a`. The dependency is the public `v0.6.0` Python wheel, pinned by URL and SHA-256.

The existing browser runtime and `app.js::trackRedSpot/rgbToHsv` remain authoritative for live teaching use. A realtime browser/Python bridge would introduce process management, transport latency, deployment and permission changes; it is outside this validation and is deferred.

## Mapping

| Project concept | Library concept | Boundary |
| --- | --- | --- |
| Canvas RGB pixels | BGR `RuntimeFrame` pixels | replay adapter only |
| `trackRedSpot()` locked state | `SensorEvent.status` / source projection `locked` | compared on identical pixels |
| weighted `x`, `y`, radius, weight sum | `payload.source_projection` | direct image observation |
| `y_max-y_min` | downstream aggregation | remains project-owned |
| `cm_per_pixel` multiplication | downstream calibration conversion | not claimed by the Sensor |

## Modes

- `legacy` (default): project-side reference of the fixed browser threshold/weight loop.
- `library`: published `SpotCentroidSensor` only.
- `compare`: runs both on the same in-memory frames, fails on direct-observation or derived-output drift.

Mode selection is local to `integration/spot_sensor/runner.py`; it does not affect the hosted page. See the runnable commands and rollback steps in the [adapter README](../integration/spot_sensor/README.md).

## Scientific interpretation

The Sensor directly observes a red light-spot centroid in image pixels. This project derives a vertical pixel range and optionally scales it with a user-drawn local ratio. Neither path directly measures mechanical amplitude. Optical geometry, exposure, camera timing, scale calibration and uncertainty still require the existing validation protocol.

## Acceptance and deferred work

Acceptance requires all deterministic cases to agree, the derived range to agree, the public wheel to install in a clean environment, the browser JavaScript to remain syntactically valid, and rollback to remain available. Real captured replay, browser end-to-end library mode, controlled motion, device repeatability and metrology validation remain deferred.
