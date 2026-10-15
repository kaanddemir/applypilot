"""Production asset integration checks; no network listener is started."""

from pathlib import Path
import sys
import unittest

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app import app  # noqa: E402


class StaticBuildTests(unittest.TestCase):
    def test_fastapi_serves_vite_index_and_hashed_assets(self):
        build = ROOT / "frontend" / "dist"
        self.assertTrue((build / "index.html").is_file(), "run npm run build first")
        with TestClient(app) as client:
            index = client.get("/")
            self.assertEqual(index.status_code, 200)
            self.assertIn("/assets/index-", index.text)
            asset_path = index.text.split('src="', 1)[1].split('"', 1)[0]
            asset = client.get(asset_path)
            self.assertEqual(asset.status_code, 200)
            self.assertGreater(len(asset.content), 1_000)


if __name__ == "__main__":
    unittest.main()
