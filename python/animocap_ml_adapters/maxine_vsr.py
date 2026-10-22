"""Thin ctypes wrapper for AniMocap's optional Maxine VFX 1.2 bridge."""

from __future__ import annotations

import ctypes
import os
from pathlib import Path
from typing import Any


def _first_file(candidates: list[Path]) -> Path | None:
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    return None


def _first_runtime(candidates: list[Path]) -> Path | None:
    required = (
        "NVCVImage.dll",
        "NVVideoEffects.dll",
        "nvngxruntime.dll",
        "nvVFXVideoSuperRes.dll",
        "nvngx_vsr.dll",
    )
    for candidate in candidates:
        if all((candidate / name).is_file() for name in required):
            return candidate.resolve()
    return None


def _resolve_bridge(root: Path, explicit: Path | None) -> Path:
    candidates: list[Path] = []
    if explicit is not None:
        candidates.append(explicit)
    environment = os.environ.get("ANIMOCAP_MAXINE_VSR_BRIDGE")
    if environment:
        candidates.append(Path(environment))
    candidates.extend((
        root / "private" / "maxine-vfx" / "animocap_maxine_vsr.dll",
        root / "build" / "animocap_maxine_vsr.dll",
        root / "build" / "Release" / "animocap_maxine_vsr.dll",
        root / "build" / "bin" / "Release" / "animocap_maxine_vsr.dll",
    ))
    candidates.extend(sorted(root.glob("build/**/animocap_maxine_vsr.dll")))
    resolved = _first_file(candidates)
    if resolved is None:
        raise RuntimeError(
            "Maxine ROI upscaling is enabled but animocap_maxine_vsr.dll was not "
            "found. Build with ANIMOCAP_MAXINE_VFX_SDK_ROOT or set "
            "ANIMOCAP_MAXINE_VSR_BRIDGE."
        )
    return resolved


def _resolve_runtime(root: Path, explicit: Path | None) -> Path:
    candidates: list[Path] = []
    if explicit is not None:
        candidates.append(explicit)
    environment = os.environ.get("ANIMOCAP_MAXINE_VFX_RUNTIME")
    if environment:
        candidates.append(Path(environment))
    candidates.extend((
        root / "private" / "maxine-vfx" / "runtime",
        Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        / "NVIDIA Corporation" / "NVIDIA Video Effects",
    ))
    resolved = _first_runtime(candidates)
    if resolved is None:
        raise RuntimeError(
            "Maxine ROI upscaling is enabled but its five runtime DLLs were not "
            "found. Put them in private/maxine-vfx/runtime or set "
            "ANIMOCAP_MAXINE_VFX_RUNTIME."
        )
    return resolved


class MaxineVsrUpscaler:
    """One reusable 2x Maxine VSR instance with a one-frame ROI cache."""

    def __init__(
        self,
        root: Path,
        cv2_module: Any,
        numpy_module: Any,
        scale: int = 2,
        quality_mode: int = 4,
        bridge_path: Path | None = None,
        runtime_path: Path | None = None,
    ) -> None:
        if scale != 2:
            raise RuntimeError("AniMocap Maxine ROI upscaling currently supports 2x")
        self.cv2 = cv2_module
        self.np = numpy_module
        self.scale = scale
        self.quality_mode = quality_mode
        self.bridge_path = _resolve_bridge(root, bridge_path)
        self.runtime_path = _resolve_runtime(root, runtime_path)
        self.library = ctypes.CDLL(str(self.bridge_path))
        self.library.animocap_maxine_vsr_create.argtypes = (
            ctypes.c_char_p,
            ctypes.c_uint,
            ctypes.c_uint,
            ctypes.c_uint,
            ctypes.c_uint,
            ctypes.c_uint,
            ctypes.c_char_p,
            ctypes.c_size_t,
        )
        self.library.animocap_maxine_vsr_create.restype = ctypes.c_void_p
        self.library.animocap_maxine_vsr_process.argtypes = (
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_uint8),
            ctypes.c_int,
            ctypes.POINTER(ctypes.c_uint8),
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_size_t,
        )
        self.library.animocap_maxine_vsr_process.restype = ctypes.c_int
        self.library.animocap_maxine_vsr_destroy.argtypes = (ctypes.c_void_p,)
        self.library.animocap_maxine_vsr_destroy.restype = None
        self.handle: int | None = None
        self.input_size: tuple[int, int] | None = None
        self.cached_index: int | None = None
        self.cached_roi: tuple[int, int, int, int] | None = None
        self.cached_frame: Any = None

    def _ensure_handle(self, width: int, height: int) -> None:
        if self.handle is not None:
            return
        error = ctypes.create_string_buffer(2048)
        handle = self.library.animocap_maxine_vsr_create(
            os.fsencode(self.runtime_path),
            width,
            height,
            width * self.scale,
            height * self.scale,
            self.quality_mode,
            error,
            len(error),
        )
        if not handle:
            raise RuntimeError(
                "Maxine VSR initialization failed: "
                + error.value.decode("utf-8", errors="replace")
            )
        self.handle = int(handle)
        self.input_size = (width, height)

    def upscale(
        self,
        bgr_frame: Any,
        frame_index: int,
        roi: tuple[int, int, int, int],
    ) -> Any:
        if (
            self.cached_index == frame_index
            and self.cached_roi == roi
            and self.cached_frame is not None
        ):
            return self.cached_frame
        if bgr_frame is None or getattr(bgr_frame, "size", 0) == 0:
            raise RuntimeError("Maxine VSR received an empty ROI frame")
        bgra = self.np.ascontiguousarray(
            self.cv2.cvtColor(bgr_frame, self.cv2.COLOR_BGR2BGRA)
        )
        height, width = bgra.shape[:2]
        self._ensure_handle(width, height)
        native_width, native_height = self.input_size or (width, height)
        if (width, height) != (native_width, native_height):
            bgra = self.np.ascontiguousarray(
                self.cv2.resize(
                    bgra,
                    (native_width, native_height),
                    interpolation=self.cv2.INTER_CUBIC,
                )
            )
        output = self.np.empty(
            (native_height * self.scale, native_width * self.scale, 4),
            dtype=self.np.uint8,
        )
        error = ctypes.create_string_buffer(2048)
        result = self.library.animocap_maxine_vsr_process(
            self.handle,
            bgra.ctypes.data_as(ctypes.POINTER(ctypes.c_uint8)),
            int(bgra.strides[0]),
            output.ctypes.data_as(ctypes.POINTER(ctypes.c_uint8)),
            int(output.strides[0]),
            error,
            len(error),
        )
        if result != 0:
            raise RuntimeError(
                "Maxine VSR frame processing failed: "
                + error.value.decode("utf-8", errors="replace")
            )
        self.cached_index = frame_index
        self.cached_roi = roi
        self.cached_frame = self.cv2.cvtColor(output, self.cv2.COLOR_BGRA2BGR)
        return self.cached_frame

    def reset_cache(self) -> None:
        self.cached_index = None
        self.cached_roi = None
        self.cached_frame = None

    def _destroy_handle(self) -> None:
        if self.handle is not None:
            self.library.animocap_maxine_vsr_destroy(self.handle)
        self.handle = None
        self.input_size = None

    def close(self) -> None:
        self.reset_cache()
        self._destroy_handle()

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass
