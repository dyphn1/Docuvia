"""Laya RSS/free-memory guard reusing CUA-S1's platform measurements."""

from __future__ import annotations

from laya_constants import MAX_PROCESS_RSS_BYTES, MIN_SYSTEM_FREE_MEMORY_PERCENT
from cua_contract import ResourceSnapshot, process_rss_bytes, system_free_memory_percent


def check_resource_budget(
    context: str,
    *,
    rss_bytes: int | None = None,
    free_percent: int | None = None,
) -> ResourceSnapshot:
    """Raise immediately when the Laya process or host crosses its hard resource limit."""
    measured_rss = process_rss_bytes() if rss_bytes is None else rss_bytes
    if measured_rss > MAX_PROCESS_RSS_BYTES:
        raise MemoryError(
            f"{context} process RSS exceeded 6 GiB: {measured_rss} bytes"
        )
    measured_free_percent = (
        system_free_memory_percent() if free_percent is None else free_percent
    )
    if measured_free_percent < MIN_SYSTEM_FREE_MEMORY_PERCENT:
        raise MemoryError(
            f"system-wide free memory fell below {MIN_SYSTEM_FREE_MEMORY_PERCENT}% "
            f"during {context}: {measured_free_percent}%"
        )
    return ResourceSnapshot(measured_rss, measured_free_percent)
