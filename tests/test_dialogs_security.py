from __future__ import annotations

import base64
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from backend_api import dialogs


class DialogSecurityTests(unittest.TestCase):
    def test_decode_limited_base64_image_accepts_png_data_url(self) -> None:
        png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
        payload = "data:image/png;base64," + base64.b64encode(png).decode("ascii")

        decoded, suffix = dialogs._decode_limited_base64_image(payload)

        self.assertEqual(decoded, png)
        self.assertEqual(suffix, ".png")

    def test_decode_limited_base64_image_rejects_non_image_payload(self) -> None:
        payload = base64.b64encode(b"not an image").decode("ascii")

        with self.assertRaisesRegex(ValueError, "JPEG, PNG, BMP, or WebP"):
            dialogs._decode_limited_base64_image(payload)

    def test_decode_limited_base64_image_rejects_oversized_payload_before_decode(self) -> None:
        old_limit = dialogs.MAX_BASE64_IMAGE_BYTES
        dialogs.MAX_BASE64_IMAGE_BYTES = 3
        try:
            payload = base64.b64encode(b"\xff\xd8\xff\x00").decode("ascii")
            with self.assertRaisesRegex(ValueError, "too large"):
                dialogs._decode_limited_base64_image(payload)
        finally:
            dialogs.MAX_BASE64_IMAGE_BYTES = old_limit

    def test_desktop_backend_service_uses_hardened_subclass(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            service = dialogs.create_desktop_backend_service(root, root / "sessions", root / "session.json")

        self.assertIsInstance(service, dialogs.DesktopBackendService)


if __name__ == "__main__":
    unittest.main()
