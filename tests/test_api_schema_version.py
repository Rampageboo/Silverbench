from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _constant(path: Path, name: str) -> int:
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"\b{name}\s*=\s*(\d+)", text)
    if not match:
        raise AssertionError(f"Could not find {name} in {path}")
    return int(match.group(1))


class ApiSchemaVersionTests(unittest.TestCase):
    def test_frontend_required_schema_matches_backend_schema(self) -> None:
        frontend = _constant(ROOT / "apps" / "desktop" / "src" / "api.ts", "REQUIRED_API_SCHEMA_VERSION")
        backend = _constant(ROOT / "backend_api" / "main.py", "API_SCHEMA_VERSION")

        self.assertEqual(frontend, backend)


if __name__ == "__main__":
    unittest.main()
