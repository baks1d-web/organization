from __future__ import annotations

import hashlib
import hmac
import json
import logging
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


@dataclass
class TelegramInitData:
    user: Dict[str, Any]
    auth_date: int


def validate_init_data(init_data: str, bot_token: str, max_age_seconds: int = 86400) -> Optional[TelegramInitData]:
    """Validate Telegram WebApp initData signature.

    Returns parsed user data if valid; otherwise None.
    """
    if not init_data:
        return None
    if not bot_token:
        logger.error("BOT_TOKEN is empty; cannot validate initData")
        return None

    parsed = urllib.parse.parse_qs(init_data, strict_parsing=True)
    if "hash" not in parsed:
        return None

    hash_received = parsed.pop("hash")[0]

    if "auth_date" not in parsed:
        return None
    try:
        auth_date = int(parsed["auth_date"][0])
    except ValueError:
        return None

    now_ts = int(datetime.now(tz=timezone.utc).timestamp())
    if now_ts - auth_date > max_age_seconds:
        logger.warning("initData expired: now=%s auth_date=%s", now_ts, auth_date)
        return None

    data_check_string = "\n".join(f"{k}={v[0]}" for k, v in sorted(parsed.items()))

    secret_key = hmac.new(
        key=b"WebAppData",
        msg=bot_token.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).digest()

    calculated_hash = hmac.new(
        key=secret_key,
        msg=data_check_string.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).hexdigest()

    if calculated_hash != hash_received:
        logger.warning("initData hash mismatch")
        return None

    try:
        user_json = urllib.parse.unquote(parsed.get("user", ["{}"]) [0])
        user_data = json.loads(user_json)
    except Exception:
        logger.exception("Failed to parse initData user")
        return None

    return TelegramInitData(user=user_data, auth_date=auth_date)
