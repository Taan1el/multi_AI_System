"""Logging helpers for the Phase 1 CLI and orchestration layer."""

from __future__ import annotations

import logging


def configure_logging(level: int = logging.INFO) -> None:
    """Set a simple process-wide logging format."""
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
