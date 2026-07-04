from __future__ import annotations

import os
import pickle
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.pt_safety import UnsafeModelError, assert_safe_pt_file


class _Evil:
    def __reduce__(self):
        return (os.system, ("echo pwned",))


def _write_zip_pt(obj: object, *, protocol: int) -> Path:
    fd, name = tempfile.mkstemp(suffix=".pt")
    os.close(fd)
    with zipfile.ZipFile(name, "w") as archive:
        archive.writestr("archive/data.pkl", pickle.dumps(obj, protocol=protocol))
    return Path(name)


def _write_raw_pt(obj: object, *, protocol: int) -> Path:
    fd, name = tempfile.mkstemp(suffix=".pt")
    os.close(fd)
    Path(name).write_bytes(pickle.dumps(obj, protocol=protocol))
    return Path(name)


class PtSafetyTests(unittest.TestCase):
    def _check_and_cleanup(self, path: Path, *, expect_unsafe: bool) -> None:
        try:
            if expect_unsafe:
                with self.assertRaises(UnsafeModelError):
                    assert_safe_pt_file(path)
            else:
                assert_safe_pt_file(path)  # must not raise
        finally:
            path.unlink(missing_ok=True)

    def test_benign_zip_checkpoint_is_allowed(self) -> None:
        path = _write_zip_pt({"model": "weights", "names": {0: "a", 1: "b"}}, protocol=4)
        self._check_and_cleanup(path, expect_unsafe=False)

    def test_malicious_stack_global_is_blocked(self) -> None:
        # protocol 4 emits STACK_GLOBAL, matching modern torch.save output.
        path = _write_zip_pt(_Evil(), protocol=4)
        self._check_and_cleanup(path, expect_unsafe=True)

    def test_malicious_inline_global_is_blocked(self) -> None:
        # protocol 2 emits the older inline GLOBAL opcode.
        path = _write_zip_pt(_Evil(), protocol=2)
        self._check_and_cleanup(path, expect_unsafe=True)

    def test_legacy_non_zip_pickle_is_scanned(self) -> None:
        path = _write_raw_pt(_Evil(), protocol=2)
        self._check_and_cleanup(path, expect_unsafe=True)

    def test_nonexistent_or_opaque_file_does_not_raise(self) -> None:
        fd, name = tempfile.mkstemp(suffix=".pt")
        os.close(fd)
        Path(name).write_bytes(b"not a pickle or zip at all")
        self._check_and_cleanup(Path(name), expect_unsafe=False)


if __name__ == "__main__":
    unittest.main()
