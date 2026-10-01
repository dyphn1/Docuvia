"""Hard RSS and macOS memory-pressure checks for bounded local model work."""

from __future__ import annotations

import re
import resource
import subprocess
import sys
from dataclasses import dataclass

from constants import MAX_PROCESS_RSS_BYTES, MIN_SYSTEM_FREE_MEMORY_PERCENT


@dataclass(frozen=True)
class ResourceSnapshot:
    process_rss_bytes: int
    system_free_memory_percent: int


def process_rss_bytes() -> int:
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(value if sys.platform == "darwin" else value * 1024)


def system_free_memory_percent() -> int:
    result = subprocess.run(
        ["memory_pressure", "-Q"],
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
    )
    match = re.search(r"System-wide memory free percentage:\s*(\d+)%", result.stdout)
    if match is None:
        raise RuntimeError("memory_pressure did not report system-wide free memory")
    return int(match.group(1))


def check_process_rss_budget(context: str) -> int:
    rss_bytes = process_rss_bytes()
    if rss_bytes > MAX_PROCESS_RSS_BYTES:
        raise MemoryError(f"{context} process RSS exceeded 3 GiB: {rss_bytes} bytes")
    return rss_bytes


def check_resource_budget(context: str) -> ResourceSnapshot:
    snapshot = ResourceSnapshot(
        process_rss_bytes=check_process_rss_budget(context),
        system_free_memory_percent=system_free_memory_percent(),
    )
    if snapshot.system_free_memory_percent < MIN_SYSTEM_FREE_MEMORY_PERCENT:
        raise MemoryError(
            f"system-wide free memory fell below {MIN_SYSTEM_FREE_MEMORY_PERCENT}% "
            f"during {context}: {snapshot.system_free_memory_percent}%"
        )
    return snapshot
