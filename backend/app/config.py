from __future__ import annotations

import os


class Config:
    # Flask
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-me")

    # Database
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", "sqlite:///instance/app.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # JWT
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "super-secret-jwt-key-change-me")
    JWT_ACCESS_TOKEN_EXPIRES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES", "3600"))  # seconds

    # Telegram
    BOT_TOKEN = os.getenv("BOT_TOKEN", "")
    TELEGRAM_VALIDATE = os.getenv("TELEGRAM_VALIDATE", "1") == "1"

    # WebApp public URL (for invite links)
    WEBAPP_URL = os.getenv("WEBAPP_URL", "")

    # Bot-to-backend auth
    BOT_API_KEY = os.getenv("BOT_API_KEY", "")
