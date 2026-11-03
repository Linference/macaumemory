import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("independent_queries", Path(__file__).resolve().parents[1] / "tools/recognize/independent_queries.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class IndependentAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "ref.jpg").write_bytes(b"reference")
        (self.root / "query.jpg").write_bytes(b"independent photo")
        (self.root / "calibration.jpg").write_bytes(b"calibration photo")
        self.lib = {"buildings": [{"id": "site", "files": ["ref.jpg"]}]}
        self.manifest = {"references": [{"key": "site/ref.jpg", "path": "ref.jpg", "captureGroup": "reference-trip", "photographer": "Alice", "capturedAt": "2025-01-01", "source": "record-1"}],
                         "queries": [{"id": "q1", "path": "query.jpg", "buildingId": "site", "split": "test", "independentCapture": True,
                                      "captureGroup": "test-trip", "photographer": "Bob", "capturedAt": "2026-01-01", "source": "record-2"}]}

    def audit(self, manifest=None):
        return module.audit_manifest(manifest or self.manifest, self.lib, self.root)

    def test_valid_and_blank_stays_pending(self):
        self.assertTrue(self.audit()["ok"])
        self.assertEqual(self.audit({"references": [], "queries": []})["status"], "pending")

    def test_renamed_reference_is_rejected(self):
        (self.root / "query.jpg").write_bytes(b"reference")
        self.assertIn("exact reference image reused", " ".join(self.audit()["errors"]))

    def test_provenance_and_truth_must_be_valid(self):
        for key, value in [("photographer", " ALICE "), ("captureGroup", " REFERENCE-TRIP "), ("capturedAt", "yesterday"), ("buildingId", "typo"), ("independentCapture", False)]:
            manifest = copy.deepcopy(self.manifest)
            manifest["queries"][0][key] = value
            self.assertFalse(self.audit(manifest)["ok"], key)

    def test_calibration_and_test_are_isolated(self):
        manifest = copy.deepcopy(self.manifest)
        manifest["queries"].append({**manifest["queries"][0], "id": "c1", "path": "calibration.jpg", "split": "calibration"})
        self.assertIn("spans calibration and test", " ".join(self.audit(manifest)["errors"]))

    def test_location_needs_photo_confirmation(self):
        self.manifest["queries"][0]["location"] = {"lng": 113.55, "lat": 22.18}
        self.assertFalse(self.audit()["ok"])
        self.manifest["queries"][0]["confirmedPhotoLocation"] = True
        self.assertTrue(self.audit()["ok"])

    def test_view_groups_hold_two_to_three_photos_of_one_visit(self):
        (self.root / "query2.jpg").write_bytes(b"second angle")
        self.manifest["queries"][0]["viewGroup"] = "visit-1"
        self.assertIn("needs 2-3 photos", " ".join(self.audit()["errors"]))
        self.manifest["queries"].append({**self.manifest["queries"][0], "id": "q2", "path": "query2.jpg"})
        self.assertTrue(self.audit()["ok"])
        for key, value in [("buildingId", "unknown:other"), ("photographer", "Carol")]:
            manifest = copy.deepcopy(self.manifest)
            manifest["queries"][1][key] = value
            self.assertIn(f"differ in {key}", " ".join(self.audit(manifest)["errors"]), key)


if __name__ == "__main__":
    unittest.main()
