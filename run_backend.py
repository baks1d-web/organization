"""Backend entrypoint.

Note: Many IDEs (e.g., PyCharm) do not automatically load variables from a .env
file when running a plain Python script. The bot already calls load_dotenv(),
but the backend must do it too, otherwise BOT_API_KEY will be empty and
/api/bot/start will return 401 Unauthorized.
"""

from dotenv import load_dotenv

load_dotenv()

from backend.app import create_app

app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(__import__("os").getenv("PORT", "5000")), debug=__import__("os").getenv("FLASK_DEBUG", "0") == "1")
