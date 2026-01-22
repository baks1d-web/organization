# Telegram Mini App + Backend (исправленная версия)

## Что было исправлено
- Убрана главная причина падения: в исходнике использовались **две разные** SQLAlchemy-инстанции (`db = SQLAlchemy(app)` и `db = SQLAlchemy()` в другом модуле). Теперь **одна** точка инициализации (`backend/app/extensions.py`).
- Переписана структура на `create_app()` (Flask app factory), разнесены роуты/утилиты/модели.
- Добавлено логирование входа/выхода и ошибок для функций (декораторы `log_call`, `log_async_call`).
- Исправлена авторизация в WebApp: теперь сохраняется **реальный JWT** и он используется в запросах.
- Добавлен блок вверху страницы с выводом данных пользователя из `initData` (`initDataUnsafe`) и наличия URL-токена.
- Реализованы базовые эндпоинты `finance`/`balance`.
- Реализован требуемый flow: **/start** → запись в БД + создание JWT на бэкенде → кнопка открытия WebApp.

## Структура
- `run_backend.py` — запуск Flask backend
- `bot/bot.py` — запуск Telegram-бота (aiogram)
- `backend/app/...` — код бэкенда
- `templates/index.html`, `static/js/app.js`, `static/css/style.css` — WebApp

## Запуск
1) Установи зависимости:
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2) Создай `.env` на основе `.env.example` и заполни значения.

3) Запусти backend:
```bash
python run_backend.py
```
Открой `http://localhost:5000/health` — должно вернуть `{ "ok": true }`.

4) Запусти бота:
```bash
python -m bot.bot
```

## Важно про WEBAPP_URL
`WEBAPP_URL` должен быть доступен из Telegram. Для локальной разработки удобно использовать tunnel (например, ngrok/cloudflared) и прописать HTTPS URL.

## Важно про безопасность
- В продакшене держи `TELEGRAM_VALIDATE=1`.
- `BOT_API_KEY` должен быть случайной строкой и храниться только на сервере и в окружении бота.
