from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
import os


def setup_logging(app_name: str = "app") -> None:
    """Configure app-wide logging."""
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    log_dir = os.getenv("LOG_DIR", "logs")
    os.makedirs(log_dir, exist_ok=True)
    file_path = os.path.join(log_dir, f"{app_name}.log")

    fmt = "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"

    root = logging.getLogger()
    root.setLevel(level)

    # Prevent duplicate handlers in reloader
    if root.handlers:
        return

    stream = logging.StreamHandler()
    stream.setLevel(level)
    stream.setFormatter(logging.Formatter(fmt))

    file = RotatingFileHandler(file_path, maxBytes=2_000_000, backupCount=5, encoding="utf-8")
    file.setLevel(level)
    file.setFormatter(logging.Formatter(fmt))

    root.addHandler(stream)
    root.addHandler(file)
