#!/usr/bin/env python3
"""Feature-flagged downstream replay adapter for tracker.spot-centroid.

The browser application remains the production/teaching legacy path. This CLI is
an offline integration seam which compares that fixed algorithm with the public
v0.6.0 library on exactly the same in-memory BGR frames.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).with_name("fixtures") / "cases.json"
VALID_BACKENDS = ("legacy", "library", "compare")


def load_fixture_spec() -> dict[str, Any]:
    return json.loads(FIXTURES.read_text(encoding="utf-8"))


def make_frame(spec: dict[str, Any], case: dict[str, Any]) -> np.ndarray:
    frame_spec = spec["frame"]
    frame = np.empty((frame_spec["height"], frame_spec["width"], 3), dtype=np.uint8)
    frame[:] = np.asarray(frame_spec["background_bgr"], dtype=np.uint8)
    spot = case["spot"]
    if spot is None:
        return frame
    yy, xx = np.ogrid[: frame.shape[0], : frame.shape[1]]
    mask = (xx - spot["x"]) ** 2 + (yy - spot["y"]) ** 2 <= spot["radius"] ** 2
    frame[mask] = np.asarray(spot["bgr"], dtype=np.uint8)
    return frame


def legacy_centroid(frame_bgr: np.ndarray) -> dict[str, Any]:
    """Direct project-side reference of app.js::rgbToHsv/trackRedSpot."""
    height, width = frame_bgr.shape[:2]
    step = 2 if width > 1000 else 1
    weight_sum = sum_x = sum_y = 0.0
    min_x = min_y = math.inf
    max_x = max_y = -math.inf
    for y in range(0, height, step):
        for x in range(0, width, step):
            b, g, r = (int(v) for v in frame_bgr[y, x, :3])
            rf, gf, bf = r / 255.0, g / 255.0, b / 255.0
            maximum, minimum = max(rf, gf, bf), min(rf, gf, bf)
            delta = maximum - minimum
            hue = 0.0
            if delta != 0:
                if maximum == rf:
                    hue = 60.0 * (((gf - bf) / delta) % 6)
                if maximum == gf:
                    hue = 60.0 * ((bf - rf) / delta + 2)
                if maximum == bf:
                    hue = 60.0 * ((rf - gf) / delta + 4)
            if hue < 0:
                hue += 360.0
            saturation = 0.0 if maximum == 0 else delta / maximum
            hue_is_red = hue <= 18 or hue >= 340
            strong_red = r > 135 and r - g > 35 and r - b > 20
            if hue_is_red and saturation > 0.38 and maximum > 0.35 and strong_red:
                weight = (saturation * maximum * 255 + max(0, r - max(g, b))) / 2
                weight_sum += weight
                sum_x += x * weight
                sum_y += y * weight
                min_x, max_x = min(min_x, x), max(max_x, x)
                min_y, max_y = min(min_y, y), max(max_y, y)
    if weight_sum <= 900:
        return {"locked": False, "x": None, "y": None, "radius": None, "weight_sum": weight_sum}
    return {
        "locked": True,
        "x": sum_x / weight_sum,
        "y": sum_y / weight_sum,
        "radius": max(7.0, math.hypot(max_x - min_x, max_y - min_y) / 2),
        "weight_sum": weight_sum,
    }


def runtime_frame(frame_bgr: np.ndarray, sequence: int, run_id: str):
    from physics_sensors.core import RuntimeFrame

    return RuntimeFrame(
        metadata={
            "schema_version": "1.0.0",
            "frame_id": str(uuid.UUID(int=sequence + 1)),
            "run_id": run_id,
            "source_sensor_id": "camera.capture",
            "sequence": sequence,
            "observed_at": f"2026-08-17T00:00:{sequence:02d}.000Z",
            "monotonic_ns": 10_000_000_000 + sequence,
            "source_timestamp": float(sequence),
            "media": {
                "kind": "camera-frame",
                "media_type": "application/x-raw-bgr",
                "width": frame_bgr.shape[1],
                "height": frame_bgr.shape[0],
                "color_space": "BGR",
                "orientation": "0",
                "mirrored": False,
            },
            "artifact": {
                "uri": f"fixture://spot-vibration/{sequence}",
                "media_type": "application/x-raw-bgr",
                "sha256": "0" * 64,
                "bytes": int(frame_bgr.nbytes),
            },
            "quality": {"dropped_since_last": 0, "flags": ["synthetic-integration-fixture"]},
        },
        pixels=frame_bgr,
    )


async def library_results(frames: list[np.ndarray]) -> list[dict[str, Any]]:
    try:
        from physics_sensors.core import SensorContext
        from physics_sensors.tracking import SpotCentroidSensor
    except ImportError as exc:
        raise RuntimeError(
            "library backend requires the pinned v0.6.0 wheel; install integration/requirements-v0.6.0.txt"
        ) from exc
    run_id = "spot-vibration-downstream-replay"
    sensor = SpotCentroidSensor(instance_id="spot-vibration-project")
    await sensor.start(SensorContext.minimal(run_id))
    events = [sensor.process_frame(runtime_frame(frame, index, run_id)) for index, frame in enumerate(frames)]
    await sensor.stop()
    return [event["payload"]["source_projection"] for event in events]


def derived_quantities(results: list[dict[str, Any]], cm_per_pixel: float) -> dict[str, float | int]:
    ys = [float(result["y"]) for result in results if result["locked"]]
    pixel_range = max(ys) - min(ys) if ys else 0.0
    return {
        "locked_samples": len(ys),
        "spot_displacement_range_px": pixel_range,
        "spot_displacement_range_cm": pixel_range * cm_per_pixel,
    }


def compare_results(legacy: list[dict[str, Any]], library: list[dict[str, Any]], tolerance: float) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    maximum_error = 0.0
    all_match = True
    for index, (old, new) in enumerate(zip(legacy, library, strict=True)):
        locked_match = old["locked"] is new["locked"]
        errors: dict[str, float | None] = {}
        for field in ("x", "y", "radius", "weight_sum"):
            if old[field] is None or new[field] is None:
                error = 0.0 if old[field] is new[field] else math.inf
            else:
                error = abs(float(old[field]) - float(new[field]))
            errors[field] = error
            maximum_error = max(maximum_error, error)
        row_match = locked_match and all(error <= tolerance for error in errors.values())
        all_match = all_match and row_match
        rows.append({"sequence": index, "match": row_match, "locked_match": locked_match, "absolute_errors": errors})
    return {"pass": all_match, "tolerance_px": tolerance, "maximum_absolute_error": maximum_error, "frames": rows}


async def run(backend: str) -> dict[str, Any]:
    spec = load_fixture_spec()
    cases = spec["cases"]
    frames = [make_frame(spec, case) for case in cases]
    selected = [next(index for index, case in enumerate(cases) if case["id"] == case_id) for case_id in spec["derived_sequence"]]
    started = time.perf_counter()
    report: dict[str, Any] = {
        "backend": backend,
        "source_project_sha": "7f0d91cc73afafaecc54acc46b2b9d69375d994a",
        "library_release": "v0.6.0",
        "library_sensor": "tracker.spot-centroid@0.4.0",
        "fixture_kind": "synthetic-downstream-replay",
        "cases": [case["id"] for case in cases],
    }
    old = [legacy_centroid(frame) for frame in frames] if backend in ("legacy", "compare") else None
    new = await library_results(frames) if backend in ("library", "compare") else None
    active = old if backend == "legacy" else new
    assert active is not None
    report["results"] = active
    report["derived"] = derived_quantities([active[index] for index in selected], float(spec["cm_per_pixel"]))
    if backend == "compare":
        assert old is not None and new is not None
        report["comparison"] = compare_results(old, new, float(spec["centroid_tolerance_px"]))
        report["legacy_derived"] = derived_quantities([old[index] for index in selected], float(spec["cm_per_pixel"]))
        report["library_derived"] = derived_quantities([new[index] for index in selected], float(spec["cm_per_pixel"]))
        report["derived_match"] = report["legacy_derived"] == report["library_derived"]
    report["duration_ms"] = (time.perf_counter() - started) * 1000
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", choices=VALID_BACKENDS, default=os.getenv("SPOT_SENSOR_BACKEND", "legacy"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        report = asyncio.run(run(args.backend))
    except (RuntimeError, ValueError) as exc:
        print(f"integration error: {exc}", file=sys.stderr)
        return 2
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    if args.backend == "compare" and (not report["comparison"]["pass"] or not report["derived_match"]):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
