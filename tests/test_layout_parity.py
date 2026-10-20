from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.workspace_layout import RELATIVE_PATHS


class LayoutParityTests(unittest.TestCase):
    def test_frontend_paths_match_backend(self) -> None:
        source = (ROOT / "apps" / "desktop" / "src" / "workspace" / "layout.ts").read_text(encoding="utf-8")
        block = re.search(r"WORKSPACE_PATHS = \{(.*?)\} as const", source, re.S)
        self.assertIsNotNone(block)
        frontend = dict(re.findall(r'(\w+): "([^"]+)"', block.group(1)))
        self.assertEqual(frontend, RELATIVE_PATHS)


if __name__ == "__main__":
    unittest.main()
