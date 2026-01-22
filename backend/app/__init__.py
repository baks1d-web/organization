from __future__ import annotations

import os
from flask import Flask

from .config import Config
from .extensions import db, jwt
from .utils.logging import setup_logging


def create_app() -> Flask:
    setup_logging(app_name=os.getenv("APP_NAME", "backend"))

    app = Flask(__name__, template_folder="../../templates", static_folder="../../static")
    app.config.from_object(Config)

    # --- SQLite path hardening ---
    # On macOS/IDE runs, the working directory is sometimes set to ./backend, making
    # relative sqlite paths like "sqlite:///instance/app.db" point to ./backend/instance.
    # We normalize any relative "instance/..." sqlite path to an absolute file path
    # anchored at the project root.
    project_root = os.path.abspath(os.path.join(app.root_path, "..", ".."))
    instance_dir = os.path.join(project_root, "instance")
    os.makedirs(instance_dir, exist_ok=True)

    uri: str = app.config.get("SQLALCHEMY_DATABASE_URI", "")
    if uri.startswith("sqlite:///") and not uri.startswith("sqlite:////"):
        rel = uri.replace("sqlite:///", "", 1)
        # Only rewrite relative paths; leave absolute ones intact
        if not rel.startswith("/"):
            abs_db_path = os.path.join(project_root, rel)
            app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{abs_db_path}"

    db.init_app(app)
    jwt.init_app(app)

    from .routes.web import web_bp
    from .routes.api import api_bp

    app.register_blueprint(web_bp)
    app.register_blueprint(api_bp, url_prefix="/api")

    with app.app_context():
        from . import models  # noqa: F401
        db.create_all()

    return app
