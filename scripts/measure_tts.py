"""Measure cached Pocket TTS CPU synthesis offline on Linux or Windows without audio playback."""

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import sys
import time
from datetime import datetime


def _windows_memory():
    import ctypes
    from ctypes import wintypes

    class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in (
                "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage",
                "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage",
            )
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    psapi.GetProcessMemoryInfo.argtypes = (
        wintypes.HANDLE, ctypes.POINTER(PROCESS_MEMORY_COUNTERS), wintypes.DWORD,
    )
    psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
    counters = PROCESS_MEMORY_COUNTERS()
    counters.cb = ctypes.sizeof(counters)
    if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        raise ctypes.WinError(ctypes.get_last_error())
    return counters


def rss_mib():
    if sys.platform == "win32":
        return _windows_memory().WorkingSetSize / 2**20
    pages = int(Path("/proc/self/statm").read_text().split()[1])
    return pages * os.sysconf("SC_PAGE_SIZE") / 2**20


def peak_mib():
    if sys.platform == "win32":
        return _windows_memory().PeakWorkingSetSize / 2**20
    import resource
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def mem_total_kib():
    if sys.platform != "win32":
        return int(Path("/proc/meminfo").read_text().splitlines()[0].split()[1])
    import ctypes
    from ctypes import wintypes

    class MEMORYSTATUSEX(ctypes.Structure):
        _fields_ = [("dwLength", wintypes.DWORD), ("dwMemoryLoad", wintypes.DWORD)] + [
            (name, ctypes.c_ulonglong) for name in (
                "ullTotalPhys", "ullAvailPhys", "ullTotalPageFile", "ullAvailPageFile",
                "ullTotalVirtual", "ullAvailVirtual", "ullAvailExtendedVirtual",
            )
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GlobalMemoryStatusEx.argtypes = (ctypes.POINTER(MEMORYSTATUSEX),)
    kernel.GlobalMemoryStatusEx.restype = wintypes.BOOL
    status = MEMORYSTATUSEX()
    status.dwLength = ctypes.sizeof(status)
    if not kernel.GlobalMemoryStatusEx(ctypes.byref(status)):
        raise ctypes.WinError(ctypes.get_last_error())
    return status.ullTotalPhys // 1024


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=("spanish", "spanish_24l"), required=True)
    parser.add_argument("--text", type=Path, required=True, help="UTF-8 input file")
    parser.add_argument("--output", type=Path, required=True, help="JSON result file")
    parser.add_argument("--runs", type=int, choices=range(1, 11), default=3)
    args = parser.parse_args()
    text = args.text.read_text(encoding="utf-8").strip()
    if not text:
        parser.error("text must not be empty")
    # Fail on missing cache entries rather than downloading models or voices.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
    import numpy as np
    import torch
    from pocket_tts import TTSModel

    if torch.version.cuda is not None:
        raise RuntimeError("This measurement requires the CPU-only Torch build")

    started = time.perf_counter()
    model = TTSModel.load_model(language=args.model)
    load_s = time.perf_counter() - started
    loaded_rss = rss_mib()
    load_peak = peak_mib()
    started = time.perf_counter()
    voice = model.get_state_for_audio_prompt("lola", truncate=True)
    voice_s = time.perf_counter() - started
    runs = []
    for index in range(args.runs):
        # Repeatable RNG state; includes first-generation warmup in run 1.
        torch.manual_seed(1234)
        np.random.seed(1234)
        cpu_start = time.process_time()
        wall_start = time.perf_counter()
        first_s = None
        samples = chunks = 0
        nonzero = False
        for chunk in model.generate_audio_stream(voice, text):
            if first_s is None:
                first_s = time.perf_counter() - wall_start
            audio = chunk.detach().cpu().numpy()
            if not np.isfinite(audio).all():
                raise RuntimeError("Non-finite generated audio")
            nonzero |= bool(np.any(audio))
            samples += audio.size
            chunks += 1
        wall_s = time.perf_counter() - wall_start
        cpu_s = time.process_time() - cpu_start
        if not nonzero or not samples or first_s is None:
            raise RuntimeError("Empty or silent generated audio")
        duration_s = samples / model.sample_rate
        runs.append({
            "run": index + 1, "wall_s": wall_s, "cpu_s": cpu_s,
            "average_cores": cpu_s / wall_s,
            "machine_cpu_percent": cpu_s / wall_s / os.cpu_count() * 100,
            "first_chunk_s": first_s, "audio_s": duration_s,
            "realtime_multiple": duration_s / wall_s,
            "chunks": chunks, "samples": samples, "rss_after_mib": rss_mib(),
            "process_peak_mib": peak_mib(),
        })
        print(f"{args.model}: run {index + 1}/{args.runs} completed", file=sys.stderr, flush=True)
    if sys.platform == "win32":
        cpu_name = platform.processor()
        distribution = platform.platform()
        memory_method = "RSS and peak from GetProcessMemoryInfo (WorkingSetSize, PeakWorkingSetSize)"
    else:
        cpu_name = next(line.split(":", 1)[1].strip()
                        for line in Path("/proc/cpuinfo").read_text().splitlines()
                        if line.startswith("model name"))
        distribution = platform.freedesktop_os_release()["PRETTY_NAME"]
        memory_method = "RSS from /proc, peak from ru_maxrss"
    result = {
        "timestamp": datetime.now().astimezone().isoformat(),
        "platform": platform.platform(), "distribution": distribution,
        "cpu": cpu_name, "logical_cpus": os.cpu_count(),
        "mem_total_kib": mem_total_kib(),
        "python": platform.python_version(),
        "versions": {name: importlib.metadata.version(name) for name in ("pocket-tts", "torch", "numpy")},
        "torch_threads": torch.get_num_threads(), "torch_interop_threads": torch.get_num_interop_threads(),
        "model": args.model, "voice": "lola", "seed": 1234,
        "text_file": args.text.as_posix(), "characters": len(text),
        "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
        "sample_rate": model.sample_rate, "load_s": load_s,
        "rss_after_load_mib": loaded_rss, "peak_after_load_mib": load_peak,
        "voice_prepare_s": voice_s, "runs": runs,
        "method": "Fresh process; cached offline weights; direct synthesis, no preprocessing, playback or speed transform. Run 1 includes warmup; runs 2-3 reuse the model. " + memory_method + ", CPU from process_time. OS file cache not cleared.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
