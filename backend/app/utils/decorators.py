from __future__ import annotations

import functools
import logging
import time
from typing import Any, Callable, TypeVar, ParamSpec

P = ParamSpec("P")
T = TypeVar("T")


def log_call(fn: Callable[P, T]) -> Callable[P, T]:
    """Log enter/exit/exception for functions (including Flask handlers)."""
    logger = logging.getLogger(fn.__module__)

    @functools.wraps(fn)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
        start = time.perf_counter()
        logger.info("→ %s()", fn.__name__)
        try:
            result = fn(*args, **kwargs)
            return result
        except Exception:
            logger.exception("✖ %s() failed", fn.__name__)
            raise
        finally:
            elapsed_ms = (time.perf_counter() - start) * 1000
            logger.info("← %s() %.1fms", fn.__name__, elapsed_ms)

    return wrapper


def log_async_call(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Same for async functions (aiogram handlers, etc.)."""
    logger = logging.getLogger(fn.__module__)

    @functools.wraps(fn)
    async def wrapper(*args: Any, **kwargs: Any):
        start = time.perf_counter()
        logger.info("→ %s()", fn.__name__)
        try:
            return await fn(*args, **kwargs)
        except Exception:
            logger.exception("✖ %s() failed", fn.__name__)
            raise
        finally:
            elapsed_ms = (time.perf_counter() - start) * 1000
            logger.info("← %s() %.1fms", fn.__name__, elapsed_ms)

    return wrapper
