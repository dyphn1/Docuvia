"""Bounded, state-only P5 resource measurements for final CUA-S1 and Laya models."""

from __future__ import annotations

import argparse
import concurrent.futures
import ctypes
import datetime as dt
import hashlib
import importlib.metadata
import json
import math
import os
import resource
import subprocess
import sys
import threading
import time
from collections import Counter
from pathlib import Path
from typing import Any, Callable

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DATASET_DIRECTORY = (
    REPOSITORY_ROOT
    / "evaluate"
    / "results"
    / "semantic-corpus"
    / "v1"
    / "system1-dataset-v2"
)
CUA_FINAL_DIRECTORY = (
    REPOSITORY_ROOT
    / "evaluate"
    / "results"
    / "semantic-corpus"
    / "v1"
    / "system1-models"
    / "cua-s1"
    / "domain-adapt-independent-v2"
    / "models"
    / "final"
)
CUA_S1_DIRECTORY = Path(__file__).resolve().parent / "cua_s1"
LAYA_OUTPUT_DIRECTORY = (
    REPOSITORY_ROOT
    / "evaluate"
    / "results"
    / "semantic-corpus"
    / "v1"
    / "system1-models"
    / "laya"
    / "domain-adapt-independent-event-v1"
)
DEFAULT_REPORT_DIRECTORY = (
    REPOSITORY_ROOT
    / "evaluate"
    / "results"
    / "semantic-corpus"
    / "v1"
    / "system1-resource-envelope-v1"
)
LAYA_DIRECTORY = Path(__file__).resolve().parent / "laya"

REQUEST_SAMPLE_SIZE = 32
WARM_LATENCY_REPEATS = 3
REPEATED_REQUEST_COUNT = 25
IDLE_WINDOW_SECONDS = 5.0
SUSTAINED_CPU_WINDOW_SECONDS = 10.0
RESOURCE_POLL_INTERVAL_SECONDS = 2.0
MAX_MODEL_RUN_SECONDS = 20 * 60
RSS_CEILING_BYTES = 512 * 1024 * 1024
CUA_PROCESS_RSS_CAP_BYTES = 3 * 1024 * 1024 * 1024
LAYA_PROCESS_RSS_CAP_BYTES = 6 * 1024 * 1024 * 1024
MIN_SYSTEM_FREE_MEMORY_PERCENT = 25
MAX_STATE_LINE_BYTES = 2_000_000


def _utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def _load_state_sample(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    state_path = DATASET_DIRECTORY / "train-state.jsonl"
    with state_path.open("rb") as source:
        for raw in source:
            if len(raw) > MAX_STATE_LINE_BYTES:
                raise ValueError("P5 state sample encountered an oversized train row")
            state = json.loads(raw)
            if not isinstance(state, dict):
                raise ValueError("P5 state sample row must be an object")
            rows.append(state)
            if len(rows) == REQUEST_SAMPLE_SIZE:
                break
    if len(rows) != REQUEST_SAMPLE_SIZE:
        raise ValueError(f"P5 requires {REQUEST_SAMPLE_SIZE} state requests, got {len(rows)}")
    encoded = b"".join(
        json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        + b"\n"
        for row in rows
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encoded)
    return rows


def _read_sample(path: Path) -> list[dict[str, Any]]:
    with path.open("rb") as source:
        values = [json.loads(line) for line in source]
    if len(values) != REQUEST_SAMPLE_SIZE or any(not isinstance(row, dict) for row in values):
        raise ValueError("P5 request sample has an invalid row count or shape")
    return values


def _disk_bytes(directory: Path) -> int:
    if not directory.is_dir():
        raise FileNotFoundError(f"model directory is missing: {directory}")
    return sum(path.stat().st_size for path in directory.rglob("*") if path.is_file())


class _ProcTaskInfo(ctypes.Structure):
    _fields_ = [
        ("virtual_size", ctypes.c_uint64),
        ("resident_size", ctypes.c_uint64),
        ("total_user", ctypes.c_uint64),
        ("total_system", ctypes.c_uint64),
        ("threads_user", ctypes.c_uint64),
        ("threads_system", ctypes.c_uint64),
        ("policy", ctypes.c_int32),
        ("faults", ctypes.c_int32),
        ("pageins", ctypes.c_int32),
        ("cow_faults", ctypes.c_int32),
        ("messages_sent", ctypes.c_int32),
        ("messages_received", ctypes.c_int32),
        ("syscalls_mach", ctypes.c_int32),
        ("syscalls_unix", ctypes.c_int32),
        ("context_switches", ctypes.c_int32),
        ("thread_count", ctypes.c_int32),
        ("running_threads", ctypes.c_int32),
        ("priority", ctypes.c_int32),
    ]


def _current_rss_bytes() -> int:
    if sys.platform != "darwin":
        raise RuntimeError("P5 current RSS sampler currently requires macOS proc_pidinfo")
    library = ctypes.CDLL("/usr/lib/libproc.dylib")
    procedure = library.proc_pidinfo
    procedure.argtypes = [
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_uint64,
        ctypes.c_void_p,
        ctypes.c_int,
    ]
    procedure.restype = ctypes.c_int
    info = _ProcTaskInfo()
    returned_bytes = procedure(
        os.getpid(), 4, 0, ctypes.byref(info), ctypes.sizeof(_ProcTaskInfo)
    )
    if returned_bytes != ctypes.sizeof(_ProcTaskInfo):
        raise RuntimeError(f"proc_pidinfo returned {returned_bytes} bytes for current RSS")
    return int(info.resident_size)


def _peak_rss_bytes() -> int:
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(value if sys.platform == "darwin" else value * 1024)


def _free_memory_percent() -> int:
    result = subprocess.run(
        ["memory_pressure", "-Q"],
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
    )
    for line in result.stdout.splitlines():
        if line.startswith("System-wide memory free percentage:"):
            return int(line.rsplit(" ", 1)[-1].rstrip("%"))
    raise RuntimeError("memory_pressure did not report system-wide free memory")


def _process_cpu_seconds() -> float:
    usage = resource.getrusage(resource.RUSAGE_SELF)
    return usage.ru_utime + usage.ru_stime


def _runtime_versions() -> dict[str, str]:
    versions = {"python": sys.version.split()[0]}
    for name in ("cua-s1", "laya", "laya-mlx", "transformers", "torch", "safetensors"):
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = "not-installed"
    return versions


class _ResourceMonitor:
    def __init__(self, process_cap_bytes: int) -> None:
        self.process_cap_bytes = process_cap_bytes
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None
        self.error: str | None = None
        self.peak_current_rss_bytes = 0
        self.peak_high_water_rss_bytes = 0
        self.minimum_free_memory_percent = 100
        self._last_free_memory_percent: int | None = None
        self._memory_check_lock = threading.Lock()
        self._last_free_memory_check = 0.0

    def _free_memory_snapshot(self) -> int:
        with self._memory_check_lock:
            now = time.monotonic()
            if (
                self._last_free_memory_percent is None
                or now - self._last_free_memory_check >= RESOURCE_POLL_INTERVAL_SECONDS
            ):
                free_percent = _free_memory_percent()
                self._last_free_memory_percent = free_percent
                self.minimum_free_memory_percent = min(
                    self.minimum_free_memory_percent, free_percent
                )
                self._last_free_memory_check = now
            assert self._last_free_memory_percent is not None
            return self._last_free_memory_percent

    def snapshot(self, context: str) -> dict[str, int]:
        if self.error is not None:
            raise MemoryError(self.error)
        current_rss = _current_rss_bytes()
        high_water = _peak_rss_bytes()
        free_percent = self._free_memory_snapshot()
        self.peak_current_rss_bytes = max(self.peak_current_rss_bytes, current_rss)
        self.peak_high_water_rss_bytes = max(self.peak_high_water_rss_bytes, high_water)
        if high_water > self.process_cap_bytes or current_rss > self.process_cap_bytes:
            raise MemoryError(
                f"{context} process RSS exceeded {self.process_cap_bytes} bytes: "
                f"current={current_rss}, highWater={high_water}"
            )
        if free_percent < MIN_SYSTEM_FREE_MEMORY_PERCENT:
            raise MemoryError(
                f"{context} system free memory fell below "
                f"{MIN_SYSTEM_FREE_MEMORY_PERCENT}%: {free_percent}%"
            )
        return {
            "currentRssBytes": current_rss,
            "highWaterRssBytes": high_water,
            "freeMemoryPercent": free_percent,
        }

    def _watch(self) -> None:
        while not self.stop_event.wait(RESOURCE_POLL_INTERVAL_SECONDS):
            try:
                self.snapshot("P5 resource monitor")
            except Exception as error:  # captured and raised by the owning thread
                self.error = f"{type(error).__name__}: {error}"
                self.stop_event.set()

    def start(self) -> None:
        self.snapshot("P5 process start")
        self.thread = threading.Thread(target=self._watch, name="p5-resource-monitor", daemon=True)
        self.thread.start()

    def finish(self) -> None:
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join(timeout=5)
        if self.error is not None:
            raise MemoryError(self.error)


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        raise ValueError("cannot compute a percentile from no measurements")
    ordered = sorted(values)
    index = (len(ordered) - 1) * percentile
    lower = math.floor(index)
    upper = math.ceil(index)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] * (upper - index) + ordered[upper] * (index - lower)


class _CuaRuntime:
    def __init__(self, checkpoint_directory: Path) -> None:
        from cua_s1.model import load_checkpoint

        sys.path.insert(0, str(CUA_S1_DIRECTORY))
        from routed_model import RoutedModel, load_routing_head

        option_model, self.collator, self.config = load_checkpoint(
            checkpoint_directory / "model.safetensors", "cpu"
        )
        self.model = RoutedModel(option_model, int(self.config["width"]))
        self.model.routing_head = load_routing_head(
            checkpoint_directory / "routing-head.safetensors",
            int(self.config["width"]),
            "cpu",
        )
        self.model.eval()

    def score_requests(self, states: list[dict[str, Any]]) -> int:
        import torch

        from cua_s1.model import ChoiceExample

        from adapter import encode_example
        from cua_contract import UNKNOWN_OPTION_ID, VERIFY_OPTION_ID

        encodings = [encode_example(state) for state in states]
        examples = [
            ChoiceExample(context=encoded.context, options=encoded.options, label=0)
            for encoded in encodings
        ]
        batch = self.collator(examples)
        with torch.inference_mode():
            option_logits, routing_logits = self.model(batch)
            option_probabilities = torch.sigmoid(option_logits)
            routing_probabilities = torch.sigmoid(routing_logits)
            for row_index, encoded in enumerate(encodings):
                routing_probability = float(routing_probabilities[row_index])
                for option_index, option_id in enumerate(encoded.option_ids):
                    probability = float(option_probabilities[row_index, option_index])
                    if option_id == VERIFY_OPTION_ID:
                        _ = 1.0 - routing_probability
                    elif option_id != UNKNOWN_OPTION_ID:
                        _ = probability * routing_probability
        return sum(len(encoded.option_ids) for encoded in encodings)


class _LayaRuntime:
    def __init__(self, output_directory: Path) -> None:
        sys.path.insert(0, str(LAYA_DIRECTORY))
        from laya_constants import DEFAULT_BASE_MODEL_DIRECTORY, INFERENCE_BATCH_SIZE
        from model import encode_text_pairs, load_encoder
        from score import _load_head

        self._encode_text_pairs = encode_text_pairs
        self._batch_size = INFERENCE_BATCH_SIZE
        self._encoder_session = load_encoder(DEFAULT_BASE_MODEL_DIRECTORY)
        self._head = _load_head(output_directory / "models" / "final")
        self._head.eval()

    def score_requests(self, states: list[dict[str, Any]]) -> int:
        import torch

        from adapter import encode_example

        encoded = [encode_example(state) for state in states]
        contexts: list[str] = []
        options: list[str] = []
        for row in encoded:
            contexts.extend([row.context] * len(row.options))
            options.extend(row.options)
        for start in range(0, len(options), self._batch_size):
            stop = min(start + self._batch_size, len(options))
            features = self._encode_text_pairs(
                self._encoder_session, contexts[start:stop], options[start:stop]
            )
            with torch.inference_mode():
                torch.sigmoid(self._head(features))
        return sum(len(row.option_ids) for row in encoded)


def _run_idle_window(monitor: _ResourceMonitor) -> dict[str, float]:
    start_wall = time.perf_counter()
    start_cpu = _process_cpu_seconds()
    deadline = start_wall + IDLE_WINDOW_SECONDS
    while time.perf_counter() < deadline:
        time.sleep(min(0.1, deadline - time.perf_counter()))
    wall = time.perf_counter() - start_wall
    cpu = _process_cpu_seconds() - start_cpu
    monitor.snapshot("P5 idle CPU window")
    return {
        "windowSeconds": round(wall, 4),
        "processCpuSeconds": round(cpu, 4),
        "cpuPercentOfOneCore": round(cpu / max(wall, 1e-9) * 100, 4),
    }


def _run_sustained_cpu_window(
    runtime: Any, states: list[dict[str, Any]], monitor: _ResourceMonitor
) -> dict[str, Any]:
    start_wall = time.perf_counter()
    start_cpu = _process_cpu_seconds()
    deadline = start_wall + SUSTAINED_CPU_WINDOW_SECONDS
    requests = options = 0
    while time.perf_counter() < deadline:
        state = states[requests % len(states)]
        options += runtime.score_requests([state])
        requests += 1
        monitor.snapshot("P5 sustained CPU window")
    wall = time.perf_counter() - start_wall
    cpu = _process_cpu_seconds() - start_cpu
    return {
        "windowSeconds": round(wall, 4),
        "requests": requests,
        "options": options,
        "processCpuSeconds": round(cpu, 4),
        "cpuPercentOfOneCore": round(cpu / max(wall, 1e-9) * 100, 4),
    }


def _run_benchmark(model_kind: str, sample_path: Path, result_path: Path) -> dict[str, Any]:
    os.environ["OMP_NUM_THREADS"] = "4"
    os.environ["MKL_NUM_THREADS"] = "4"
    os.environ["VECLIB_MAXIMUM_THREADS"] = "4"
    states = _read_sample(sample_path)
    sys.path.insert(0, str(LAYA_DIRECTORY))
    from adapter import encode_example
    from cua_contract import (
        CANDIDATE_OPTION_KIND,
        OPTION_KIND_KEY,
        state_repository_family,
    )

    import torch

    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)

    if model_kind == "cua-s1":
        process_cap = CUA_PROCESS_RSS_CAP_BYTES
        model_directory = CUA_FINAL_DIRECTORY
        runtime_factory: Callable[[], Any] = lambda: _CuaRuntime(model_directory)
        base_directory_bytes = 0
        model_name = "CUA-S1 domain-adapt-independent-v2 final checkpoint"
    elif model_kind == "laya":
        process_cap = LAYA_PROCESS_RSS_CAP_BYTES
        model_directory = LAYA_OUTPUT_DIRECTORY / "models" / "final"
        runtime_factory = lambda: _LayaRuntime(LAYA_OUTPUT_DIRECTORY)
        from laya_constants import DEFAULT_BASE_MODEL_DIRECTORY

        base_directory_bytes = _disk_bytes(DEFAULT_BASE_MODEL_DIRECTORY)
        model_name = "Laya independent-event-v1 final option head plus frozen encoder"
    else:
        raise ValueError(f"unsupported P5 model: {model_kind}")

    for state in states:
        encode_example(state)
    sample_bytes = sample_path.read_bytes()
    option_counts = [len(encode_example(state).option_ids) for state in states]
    candidate_counts = [
        sum(
            option.get(OPTION_KIND_KEY) == CANDIDATE_OPTION_KIND
            for option in state["request"]["options"]
        )
        for state in states
    ]

    monitor = _ResourceMonitor(process_cap)
    monitor.start()
    before_load = monitor.snapshot(f"{model_kind} before model load")
    load_started = time.perf_counter()
    runtime = runtime_factory()
    cold_load_seconds = time.perf_counter() - load_started
    after_load = monitor.snapshot(f"{model_kind} after model load")

    idle_cpu = _run_idle_window(monitor)
    runtime.score_requests([states[0]])
    latency_seconds: list[float] = []
    warm_started = time.perf_counter()
    for _ in range(WARM_LATENCY_REPEATS):
        for state in states:
            start = time.perf_counter()
            runtime.score_requests([state])
            latency_seconds.append(time.perf_counter() - start)
            monitor.snapshot(f"{model_kind} warm latency sample")
    warm_elapsed = time.perf_counter() - warm_started

    batch_elapsed_samples: list[float] = []
    batch_options = 0
    for _ in range(3):
        start = time.perf_counter()
        batch_options = runtime.score_requests(states)
        batch_elapsed_samples.append(time.perf_counter() - start)
        monitor.snapshot(f"{model_kind} batch throughput sample")
    batch_wall = sum(batch_elapsed_samples)
    batch_elapsed = batch_wall / len(batch_elapsed_samples)

    repeated_before = monitor.snapshot(f"{model_kind} repeated request start")
    repeated_started = time.perf_counter()
    repeated_options = 0
    repeated_peak_current_rss = repeated_before["currentRssBytes"]
    for _ in range(REPEATED_REQUEST_COUNT):
        repeated_options += runtime.score_requests([states[0]])
        repeated_snapshot = monitor.snapshot(f"{model_kind} repeated request")
        repeated_peak_current_rss = max(
            repeated_peak_current_rss, repeated_snapshot["currentRssBytes"]
        )
    repeated_elapsed = time.perf_counter() - repeated_started
    repeated_after = monitor.snapshot(f"{model_kind} repeated request end")

    concurrent_started = time.perf_counter()
    concurrent_options = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [
            executor.submit(runtime.score_requests, [states[(client * 2 + turn) % len(states)]])
            for client in range(4)
            for turn in range(2)
        ]
        for future in concurrent.futures.as_completed(futures):
            concurrent_options += future.result()
            monitor.snapshot(f"{model_kind} shared-model concurrent client")
    concurrent_elapsed = time.perf_counter() - concurrent_started

    sustained_cpu = _run_sustained_cpu_window(runtime, states, monitor)
    finished = monitor.snapshot(f"{model_kind} benchmark complete")
    monitor.finish()

    disk_model_bytes = _disk_bytes(model_directory)
    response = {
        "schema": "system1-p5-resource-result/v1",
        "measuredAtUtc": _utc_now(),
        "model": model_name,
        "modelKind": model_kind,
        "runtimeVersions": _runtime_versions(),
        "modelDirectory": str(model_directory),
        "modelDirectoryDiskBytes": disk_model_bytes,
        "baseEncoderDirectory": str(DEFAULT_BASE_MODEL_DIRECTORY) if model_kind == "laya" else None,
        "baseEncoderDiskBytes": base_directory_bytes,
        "totalServingComponentsDiskBytes": disk_model_bytes + base_directory_bytes,
        "rssCeilingBytes": RSS_CEILING_BYTES,
        "rssCeilingMiB": 512,
        "processRssCapBytes": process_cap,
        "rssAfterLoadBytes": after_load["currentRssBytes"],
        "rssBeforeLoadBytes": before_load["currentRssBytes"],
        "incrementalRssAfterLoadBytes": max(
            0, after_load["currentRssBytes"] - before_load["currentRssBytes"]
        ),
        "peakCurrentRssBytes": monitor.peak_current_rss_bytes,
        "peakProcessRssBytes": monitor.peak_high_water_rss_bytes,
        "peakRssIncrementalOverBaselineBytes": max(
            0, monitor.peak_high_water_rss_bytes - before_load["highWaterRssBytes"]
        ),
        "rssLimitLabel": "PASS"
        if monitor.peak_high_water_rss_bytes <= RSS_CEILING_BYTES
        else "FAIL",
        "coldLoadSeconds": round(cold_load_seconds, 4),
        "idleCpuWindow": idle_cpu,
        "warmLatencySeconds": {
            "sampleCount": len(latency_seconds),
            "requestSampleSize": len(states),
            "repeatCount": WARM_LATENCY_REPEATS,
            "p50": round(_percentile(latency_seconds, 0.50), 6),
            "p95": round(_percentile(latency_seconds, 0.95), 6),
            "p99": round(_percentile(latency_seconds, 0.99), 6),
            "totalElapsedSeconds": round(warm_elapsed, 4),
        },
        "batchThroughput": {
            "batchRequests": len(states),
            "optionsPerBatch": batch_options,
            "repeatCount": len(batch_elapsed_samples),
            "meanBatchSeconds": round(batch_elapsed, 6),
            "requestsPerSecond": round(len(states) / max(batch_elapsed, 1e-9), 4),
            "optionsPerSecond": round(batch_options / max(batch_elapsed, 1e-9), 4),
        },
        "repeatedRequestRss": {
            "requestCount": REPEATED_REQUEST_COUNT,
            "options": repeated_options,
            "elapsedSeconds": round(repeated_elapsed, 4),
            "rssBeforeBytes": repeated_before["currentRssBytes"],
            "rssAfterBytes": repeated_after["currentRssBytes"],
            "peakCurrentRssBytes": repeated_peak_current_rss,
            "rssGrowthBytes": repeated_after["currentRssBytes"]
            - repeated_before["currentRssBytes"],
        },
        "multiClientSharing": {
            "clientCount": 4,
            "requests": 8,
            "options": concurrent_options,
            "elapsedSeconds": round(concurrent_elapsed, 4),
            "requestsPerSecond": round(8 / max(concurrent_elapsed, 1e-9), 4),
            "optionsPerSecond": round(concurrent_options / max(concurrent_elapsed, 1e-9), 4),
            "oneModelInstanceShared": True,
        },
        "sustainedCpuWindow": sustained_cpu,
        "requestSample": {
            "path": str(sample_path),
            "sha256": hashlib.sha256(sample_bytes).hexdigest(),
            "requests": len(states),
            "optionEventsIncludingControls": sum(option_counts),
            "candidateOptions": sum(candidate_counts),
            "repositoryFamilyCounts": dict(
                sorted(Counter(state_repository_family(state) for state in states).items())
            ),
            "requestIds": [state["request"]["requestId"] for state in states],
            "sourceSplit": "train states only; labels not read",
        },
        "minimumSystemFreeMemoryPercent": monitor.minimum_free_memory_percent,
        "finalResourceSnapshot": finished,
    }
    _write_json(result_path, response)
    return response


def _run_suite(report_directory: Path) -> dict[str, Any]:
    report_directory.mkdir(parents=True, exist_ok=True)
    sample_path = report_directory / "request-sample-state-only.jsonl"
    states = _load_state_sample(sample_path)
    results: dict[str, Any] = {}
    for model_kind in ("cua-s1", "laya"):
        result_path = report_directory / f"{model_kind}-resource-result.json"
        log_path = report_directory / f"{model_kind}-resource-run.log"
        command = [
            sys.executable,
            str(Path(__file__).resolve()),
            "--model",
            model_kind,
            "--request-sample",
            str(sample_path),
            "--result",
            str(result_path),
        ]
        environment = os.environ.copy()
        environment.update(
            {
                "OMP_NUM_THREADS": "4",
                "MKL_NUM_THREADS": "4",
                "VECLIB_MAXIMUM_THREADS": "4",
                "HF_HUB_OFFLINE": "1",
                "TRANSFORMERS_OFFLINE": "1",
            }
        )
        started = time.perf_counter()
        try:
            completed = subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
                timeout=MAX_MODEL_RUN_SECONDS,
                env=environment,
            )
        except subprocess.CalledProcessError as error:
            log_path.write_text(
                f"exitCode={error.returncode}\nstdout:\n{error.stdout}\nstderr:\n{error.stderr}",
                encoding="utf-8",
            )
            raise RuntimeError(f"{model_kind} P5 failed; see {log_path}") from error
        except subprocess.TimeoutExpired as error:
            log_path.write_text(
                f"P5 timeout after {MAX_MODEL_RUN_SECONDS} seconds\n"
                f"stdout:\n{error.stdout}\nstderr:\n{error.stderr}",
                encoding="utf-8",
            )
            raise RuntimeError(f"{model_kind} P5 exceeded its bounded runtime") from error
        log_path.write_text(
            f"elapsedSeconds={time.perf_counter() - started:.4f}\n"
            f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}",
            encoding="utf-8",
        )
        results[model_kind] = json.loads(result_path.read_text(encoding="utf-8"))

    report = {
        "schema": "system1-p5-resource-envelope/v1",
        "measuredAtUtc": _utc_now(),
        "machine": {
            "hardware": "Apple M4",
            "logicalCpus": 10,
            "physicalMemoryBytes": 16 * 1024 * 1024 * 1024,
            "torchThreads": 4,
            "torchInteropThreads": 1,
        },
        "measurementProtocol": {
            "requestSampleSize": REQUEST_SAMPLE_SIZE,
            "sameStateOnlySampleForBothModels": True,
            "idleCpuWindowSeconds": IDLE_WINDOW_SECONDS,
            "sustainedCpuWindowSeconds": SUSTAINED_CPU_WINDOW_SECONDS,
            "warmLatencyRepeats": WARM_LATENCY_REPEATS,
            "repeatedRequestCount": REPEATED_REQUEST_COUNT,
            "multiClientCount": 4,
            "modelRunsSequential": True,
            "currentRssMethod": "macOS libproc proc_pidinfo(PROC_PIDTASKINFO)",
            "peakRssMethod": "resource.getrusage(RUSAGE_SELF).ru_maxrss high-water RSS",
            "servingRssCeilingBytes": RSS_CEILING_BYTES,
        },
        "servingRssEnvelope": {
            "ceilingBytes": RSS_CEILING_BYTES,
            "modelLabels": {
                model_kind: model_result["rssLimitLabel"]
                for model_kind, model_result in results.items()
            },
            "overallLabel": "PASS"
            if all(
                model_result["rssLimitLabel"] == "PASS"
                for model_result in results.values()
            )
            else "FAIL",
        },
        "requestSample": {
            "path": str(sample_path),
            "sha256": hashlib.sha256(sample_path.read_bytes()).hexdigest(),
            "requests": len(states),
        },
        "models": results,
    }
    _write_json(report_directory / "report.json", report)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=("cua-s1", "laya"))
    parser.add_argument("--request-sample", type=Path)
    parser.add_argument("--result", type=Path)
    parser.add_argument("--report-directory", type=Path, default=DEFAULT_REPORT_DIRECTORY)
    arguments = parser.parse_args()
    if arguments.model is None:
        _run_suite(arguments.report_directory.resolve())
        return 0
    if arguments.request_sample is None or arguments.result is None:
        parser.error("--model requires --request-sample and --result")
    result = _run_benchmark(
        arguments.model, arguments.request_sample.resolve(), arguments.result.resolve()
    )
    print(json.dumps({"model": arguments.model, "rssLimitLabel": result["rssLimitLabel"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
