from __future__ import annotations

from flask import Blueprint, render_template

from ..utils.decorators import log_call

web_bp = Blueprint("web", __name__)


@web_bp.get("/")
@log_call
def index():
    return render_template("index.html")


@web_bp.get("/health")
@log_call
def health():
    return {"ok": True}
