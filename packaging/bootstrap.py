"""Prepare the installed app's per-user runtime before the backend starts.

Run by the bundled Python on every start (the desktop shell waits for it):

1. Sync the AniMocap engine's code into its per-user root when the app version
   changed. ``.venv-mmpose`` and ``private/`` (models, Maxine runtime) there are
   never touched, so they survive updates.
2. Create or update the runtime venv from ``requirements.lock.txt`` when the lock
   changed (first run: ~4 GB download). Normal starts only compare a hash.

Progress goes to a JSON status file the window shows; a failure leaves the
error and the pip log tail there. Exit code 0 = ready.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

TORCH_INDEX = "https://download.pytorch.org/whl/cu130"
TORCH_PACKAGES = ("torch", "torchvision")
# Folders of the engine that come from the install; everything else in its root is user state.
ENGINE_CODE = ("build", "python", "tools", "configs", "schemas", "blender_addon")
CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


class Status:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.log: list[str] = []
        self.state: dict = {"stage": "starting", "message": "", "percent": 0, "done": False, "error": None}
        self._written = 0.0

    def update(self, **changes) -> None:
        self.state.update(changes)
        self._write(force=True)

    def line(self, text: str) -> None:
        text = text.rstrip()
        if text:
            self.log.append(text[-300:])
            self._write(force=False)  # pip prints hundreds of lines; a few writes a second suffice

    def _write(self, *, force: bool) -> None:
        now = time.monotonic()
        if not force and now - self._written < 0.25:
            return
        self._written = now
        self.state["log"] = self.log[-12:]
        self.state["updatedAt"] = time.time()
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(".tmp")
            temporary.write_text(json.dumps(self.state, ensure_ascii=False), encoding="utf-8")
            # The window reads this file every second; Windows refuses to replace a file
            # another process has open, so retry briefly. Progress display must never
            # abort the install.
            for _ in range(40):
                try:
                    os.replace(temporary, self.path)
                    return
                except PermissionError:
                    time.sleep(0.05)
        except OSError:
            pass


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sync_engine(source: Path, target: Path, version: str, status: Status) -> None:
    marker = target / ".rwb-engine-version"
    if marker.is_file() and marker.read_text(encoding="utf-8").strip() == version:
        return
    status.update(stage="engine", message="正在更新动捕引擎…", percent=2)
    target.mkdir(parents=True, exist_ok=True)
    for name in ENGINE_CODE:
        destination = target / name
        if destination.exists():
            shutil.rmtree(destination)
        if (source / name).exists():
            shutil.copytree(source / name, destination, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for item in source.iterdir():
        if item.is_file():
            shutil.copy2(item, target / item.name)
    marker.write_text(version, encoding="utf-8")


def _run(command: list[str], status: Status) -> None:
    status.line("> " + " ".join(command[1:]))
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env={**os.environ, "PYTHONUTF8": "1", "PIP_DISABLE_PIP_VERSION_CHECK": "1"},
        creationflags=CREATE_NO_WINDOW,
    )
    assert process.stdout is not None
    for line in process.stdout:
        status.line(line)
    if process.wait() != 0:
        raise RuntimeError(f"命令失败（退出码 {process.returncode}）：{' '.join(command[1:4])} …")


def ensure_venv(venv: Path, lock: Path, status: Status) -> None:
    marker = venv / "rwb-runtime.json"
    lock_hash = _sha256(lock)
    python = venv / "Scripts" / "python.exe"
    if python.is_file() and marker.is_file():
        try:
            if json.loads(marker.read_text(encoding="utf-8")).get("lockHash") == lock_hash:
                return
        except (OSError, ValueError):
            pass
    if not python.is_file():
        status.update(stage="venv", message="正在创建 Python 运行环境…", percent=5)
        _run([sys.executable, "-m", "venv", str(venv)], status)

    pins = [line.strip() for line in lock.read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith("#")]
    torch_pins = [pin for pin in pins if pin.split("==")[0].lower() in TORCH_PACKAGES]
    other_pins = [pin for pin in pins if pin not in torch_pins]
    rest = venv / "rwb-requirements.txt"
    rest.write_text("\n".join(other_pins) + "\n", encoding="utf-8")
    # --no-deps: the lock is the complete, tested set; resolving would re-add the
    # conflicting opencv-python that ultralytics declares.
    pip = [str(python), "-m", "pip", "install", "--no-deps", "--progress-bar", "off"]
    status.update(stage="torch", message="正在下载 PyTorch（CUDA，约 2.5 GB，首次较慢）…", percent=10)
    _run(pip + ["--index-url", TORCH_INDEX, *torch_pins], status)
    status.update(stage="packages", message="正在安装其余依赖…", percent=70)
    _run(pip + ["-r", str(rest)], status)
    status.update(stage="verify", message="正在检查运行环境…", percent=95)
    _run([str(python), "-c", "import fastapi, uvicorn, numpy, cv2, torch, ultralytics; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"], status)
    marker.write_text(json.dumps({"lockHash": lock_hash, "python": sys.version, "createdAt": time.time()}), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", type=Path, required=True, help="bundled app folder (resources/app)")
    parser.add_argument("--data", type=Path, required=True, help="per-user data folder")
    parser.add_argument("--version", required=True)
    parser.add_argument("--status", type=Path, required=True)
    args = parser.parse_args()
    status = Status(args.status)
    try:
        status.update(stage="checking", message="正在检查运行环境…", percent=1)
        sync_engine(args.app / "engines" / "animocap", args.data / "animocap", args.version, status)
        ensure_venv(args.data / "runtime" / "venv", args.app / "packaging" / "requirements.lock.txt", status)
        status.update(stage="ready", message="运行环境已就绪", percent=100, done=True)
        return 0
    except Exception as error:  # noqa: BLE001 - the window shows any failure with the log
        status.update(stage="failed", message="运行环境准备失败", error=str(error), done=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
