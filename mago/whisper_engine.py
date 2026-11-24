"""Whisper on the GPU, with a CPU fallback. Models are loaded once and kept."""

import ctypes
import fcntl
import glob
import os
import site
import subprocess
from pathlib import Path

from . import config

MIN_FREE_VRAM_MB = 1500
_cuda_libs_loaded = False


def _preload_cuda_libs() -> None:
    """ctranslate2 looks for cuBLAS and cuDNN on the system path; ours come
    from pip packages inside the venv, so load them by full path first."""
    global _cuda_libs_loaded
    if _cuda_libs_loaded:
        return
    _cuda_libs_loaded = True
    for packages in site.getsitepackages():
        for name in ("cublas/lib/libcublasLt.so.*", "cublas/lib/libcublas.so.*", "cudnn/lib/libcudnn*.so.*"):
            for lib in sorted(glob.glob(os.path.join(packages, "nvidia", name))):
                try:
                    ctypes.CDLL(lib, mode=ctypes.RTLD_GLOBAL)
                except OSError:
                    pass


def free_vram_mb() -> int:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=15,
        )
        return int(result.stdout.split()[0])
    except Exception:  # noqa: BLE001 - no GPU or driver: report none free
        return 0


def gpu_lock_busy(lock_path: Path | None = None) -> bool:
    """True while another program holds its exclusive GPU lock (a measurement is
    running). We only look: the lock is released again immediately."""
    lock_path = lock_path or config.GPU_LOCK
    if not lock_path.exists():
        return False
    try:
        with open(lock_path, "rb") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return True
            fcntl.flock(handle, fcntl.LOCK_UN)
    except OSError:
        return False
    return False


class Engine:
    """Keeps one model per device in memory and picks the device per job."""

    def __init__(self, model_name: str = "small", device: str = "auto"):
        self.model_name, self.device_setting = model_name, device
        self._models: dict[str, object] = {}
        self._cuda_broken = False

    def _load(self, device: str):
        if device not in self._models:
            from faster_whisper import WhisperModel

            if device == "cuda":
                _preload_cuda_libs()
            # Measured on the GTX 1650 (18.7 min lecture, small model): float16 ran at 8 times real
            # time, int8_float32 at 30 times with half the memory. The 16xx cards have no fast
            # half-precision path, so float16 is the slow choice there.
            compute_type = "int8_float32" if device == "cuda" else "int8"
            self._models[device] = WhisperModel(self.model_name, device=device, compute_type=compute_type)
        return self._models[device]

    def _wanted_devices(self) -> list[str]:
        if self.device_setting == "cpu" or self._cuda_broken:
            return ["cpu"]
        if gpu_lock_busy():
            return ["cpu"]
        if "cuda" not in self._models and free_vram_mb() < MIN_FREE_VRAM_MB:
            return ["cpu"]
        return ["cuda", "cpu"]

    def transcribe(self, audio: Path, language: str | None = None, translate: bool = False, on_progress=None,
                   hint: str | None = None) -> dict:
        """Returns {"segments", "language", "device"}. A CUDA failure (missing
        library, out of memory) falls back to the CPU for this and later jobs."""
        last_error: Exception | None = None
        for device in self._wanted_devices():
            try:
                model = self._load(device)
                parts, info = model.transcribe(
                    str(audio), language=language or None, task="translate" if translate else "transcribe",
                    vad_filter=True, condition_on_previous_text=False,
                    beam_size=1,  # 1.7 times faster than the default 5; the text differed by under 1% in our test
                    initial_prompt=hint or None,  # names and terms from the title: Whisper then spells them right
                )
                segments = []
                for part in parts:  # lazy: the real work happens while iterating
                    text = part.text.strip()
                    if text:
                        segments.append({"start": float(part.start), "end": float(part.end), "text": text})
                    if on_progress and info.duration:
                        on_progress(min(1.0, part.end / info.duration))
                return {"segments": segments, "language": info.language, "device": device}
            except Exception as error:  # noqa: BLE001 - broken CUDA stack → CPU
                last_error = error
                if device == "cuda":
                    self._cuda_broken = True
                    self._models.pop("cuda", None)
        raise RuntimeError(f"no usable Whisper backend: {last_error}")
