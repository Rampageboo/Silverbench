from __future__ import annotations

import os
import sys
from typing import Any


def torch_runtime_info() -> dict[str, Any]:
    info: dict[str, Any] = {
        "python": sys.executable,
        "cudaVisibleDevices": os.environ.get("CUDA_VISIBLE_DEVICES"),
        "torchInstalled": False,
        "torchPath": "",
        "torchVersion": "",
        "torchCudaVersion": None,
        "cudaAvailable": False,
        "cudaDeviceCount": 0,
        "cudaDeviceName": "",
    }
    try:
        import torch

        info["torchInstalled"] = True
        info["torchPath"] = getattr(torch, "__file__", "")
        info["torchVersion"] = getattr(torch, "__version__", "")
        info["torchCudaVersion"] = getattr(getattr(torch, "version", None), "cuda", None)
        info["cudaAvailable"] = bool(torch.cuda.is_available())
        info["cudaDeviceCount"] = int(torch.cuda.device_count())
        if info["cudaAvailable"] and info["cudaDeviceCount"]:
            info["cudaDeviceName"] = torch.cuda.get_device_name(0)
    except Exception as error:
        info["torchError"] = str(error)
    return info


def require_cuda_device(device: str) -> None:
    requested = str(device or "").strip().lower()
    if requested in {"", "cpu"}:
        return
    if not (requested.startswith("cuda") or requested.split(",", 1)[0].isdigit()):
        return
    info = torch_runtime_info()
    if info["cudaAvailable"] and info["cudaDeviceCount"]:
        return
    raise RuntimeError(
        "GPU device was requested but this server Python cannot see CUDA.\n"
        f"Python: {info['python']}\n"
        f"torch: {info['torchVersion']} at {info['torchPath']}\n"
        f"torch.version.cuda: {info['torchCudaVersion']}\n"
        f"torch.cuda.is_available(): {info['cudaAvailable']}\n"
        f"torch.cuda.device_count(): {info['cudaDeviceCount']}\n"
        f"CUDA_VISIBLE_DEVICES: {info['cudaVisibleDevices']}\n"
        "Start the server with the Python that has CUDA PyTorch installed."
    )
