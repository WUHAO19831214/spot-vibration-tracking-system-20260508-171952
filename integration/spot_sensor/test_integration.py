from __future__ import annotations

import asyncio
import unittest

from runner import run


class SpotSensorIntegrationTest(unittest.TestCase):
    def test_legacy_default_path_remains_available(self) -> None:
        report = asyncio.run(run("legacy"))
        self.assertEqual(report["backend"], "legacy")
        self.assertEqual(report["derived"]["spot_displacement_range_px"], 28.0)
        self.assertAlmostEqual(report["derived"]["spot_displacement_range_cm"], 0.56)

    def test_released_library_matches_legacy_observations_and_derived_output(self) -> None:
        report = asyncio.run(run("compare"))
        self.assertTrue(report["comparison"]["pass"], report["comparison"])
        self.assertLessEqual(
            report["comparison"]["maximum_absolute_error"],
            report["comparison"]["tolerance_px"],
        )
        self.assertEqual(report["comparison"]["frames"][0]["frame_id"], "normal")
        self.assertIn("legacy", report["comparison"]["frames"][0])
        self.assertIn("library", report["comparison"]["frames"][0])
        self.assertIn("delta", report["comparison"]["frames"][0])
        self.assertTrue(report["derived_match"])

    def test_blank_is_explicitly_lost(self) -> None:
        report = asyncio.run(run("library"))
        blank_index = report["cases"].index("blank")
        self.assertFalse(report["results"][blank_index]["locked"])
        self.assertIsNone(report["results"][blank_index]["x"])
        self.assertIsNone(report["results"][blank_index]["y"])


if __name__ == "__main__":
    unittest.main()
