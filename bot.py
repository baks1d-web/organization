import asyncio
import logging
import os

import aiohttp
from aiogram import Bot, Dispatcher
from aiogram.filters import Command
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo, CallbackQuery
import json
from dotenv import load_dotenv

from backend.app.utils.decorators import log_async_call
from backend.app.utils.logging import setup_logging

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
WEBAPP_URL = os.getenv("WEBAPP_URL", "")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:5000")
BOT_API_KEY = os.getenv("BOT_API_KEY", "")

if not BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN не установлен")
if not WEBAPP_URL:
    raise RuntimeError("WEBAPP_URL не установлен")
if not BOT_API_KEY:
    raise RuntimeError("BOT_API_KEY не установлен (нужен для /api/bot/start)")

setup_logging(app_name=os.getenv("APP_NAME", "bot"))
logger = logging.getLogger("bot")

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()


async def backend_start_session(tg_user) -> dict:
    """Create user + JWT on backend (as required by /start flow)."""
    url = BACKEND_URL.rstrip("/") + "/api/bot/start"
    payload = {
        "tg_id": tg_user.id,
        "username": tg_user.username,
        "first_name": tg_user.first_name,
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(
            url,
            json=payload,
            headers={"X-Bot-Api-Key": BOT_API_KEY, "Content-Type": "application/json"},
            timeout=aiohttp.ClientTimeout(total=15),
            ssl=False,
        ) as resp:
            body_text = await resp.text()

            # Логируем, что реально вернул сервер
            logger.info("backend_start_session: status=%s body=%s", resp.status, body_text[:1000])

            try:
                data = json.loads(body_text) if body_text else {}
            except Exception:
                raise RuntimeError(f"Backend returned non-JSON response: status={resp.status}, body={body_text[:300]}")

            if resp.status != 200 or not data.get("ok"):
                raise RuntimeError(f"Backend error: status={resp.status}, body={data}")

            return data


async def backend_get_pending_invites(user) -> list[dict]:
    url = f"{BACKEND_URL.rstrip('/')}/api/bot/invites/pending"
    payload = {"tg_id": user.id, "username": getattr(user, "username", None)}
    async with aiohttp.ClientSession() as session:
        async with session.post(
                url,
                json=payload,
                headers={"X-Bot-Api-Key": BOT_API_KEY},
                timeout=aiohttp.ClientTimeout(total=10),
                ssl=False,
        ) as resp:
            data = await resp.json()
            if resp.status != 200 or not data.get("ok"):
                return []
            return data.get("items") or []


async def backend_accept_invite(user, invite_id: int) -> bool:
    url = f"{BACKEND_URL.rstrip('/')}/api/bot/invites/{invite_id}/accept"
    payload = {"tg_id": user.id}
    async with aiohttp.ClientSession() as session:
        async with session.post(
                url,
                json=payload,
                headers={"X-Bot-Api-Key": BOT_API_KEY},
                timeout=aiohttp.ClientTimeout(total=10),
                ssl=False,
        ) as resp:
            data = await resp.json()
            return resp.status == 200 and data.get("ok") is True


async def backend_decline_invite(user, invite_id: int) -> bool:
    url = f"{BACKEND_URL.rstrip('/')}/api/bot/invites/{invite_id}/decline"
    payload = {"tg_id": user.id}
    async with aiohttp.ClientSession() as session:
        async with session.post(
                url,
                json=payload,
                headers={"X-Bot-Api-Key": BOT_API_KEY},
                timeout=aiohttp.ClientTimeout(total=10),
                ssl=False,
        ) as resp:
            data = await resp.json()
            return resp.status == 200 and data.get("ok") is True

@dp.message(Command("start"))
@log_async_call
async def cmd_start(message: Message):
    user = message.from_user
    logger.info("/start from tg_id=%s username=%s", user.id, user.username)

    # 1) DB write + JWT creation on backend
    try:
        data = await backend_start_session(user)
        # показать pending приглашения
        if getattr(user, "username", None):
            invites = await backend_get_pending_invites(user)
            for inv in invites:
                kb = InlineKeyboardMarkup(inline_keyboard=[
                    [
                        InlineKeyboardButton(text="✅ Принять", callback_data=f"inv_accept:{inv['id']}"),
                        InlineKeyboardButton(text="❌ Отклонить", callback_data=f"inv_decline:{inv['id']}"),
                    ]
                ])
                by = inv.get("created_by") or {}
                by_name = by.get("first_name") or by.get("username") or "пользователь"
                await message.answer(
                    f"Вас пригласили в группу: <b>{inv.get('group_name')}</b>\n"
                    f"Пригласил: {by_name}\n\nПринять приглашение?",
                    reply_markup=kb
                )
        else:
            await message.answer("⚠️ У вас не установлен username (@ник). Вас нельзя пригласить по нику.")

        token = data["access_token"]
    except Exception as e:
        logger.exception("Failed to create backend session")
        await message.answer(
            "Не смог создать сессию на сервере 😕\n"
            "Проверь, что backend запущен и BACKEND_URL/BOT_API_KEY настроены.\n\n"
            f"Ошибка: {e}"
        )
        return

    # 2) WebApp button (token также пробрасываем query-param для debug/резервного входа)
    web_url = WEBAPP_URL
    sep = "&" if "?" in web_url else "?"
    web_url = f"{web_url}{sep}token={token}"

    keyboard = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Открыть приложение", web_app=WebAppInfo(url=web_url))]])

    await message.answer(
        "Добро пожаловать! 👋\n"
        "JWT создан, доступ к приложению открыт.\n\n"
        "Нажми кнопку ниже, чтобы открыть Mini App:",
        reply_markup=keyboard,
        disable_web_page_preview=True,
    )


@dp.message(Command("ping"))
@log_async_call
async def cmd_ping(message: Message):
    await message.answer("Pong! ✅")


@dp.message(Command("id"))
@log_async_call
async def cmd_id(message: Message):
    await message.answer(f"Ваш Telegram ID: <code>{message.from_user.id}</code>")

@dp.callback_query(lambda c: c.data and c.data.startswith("inv_accept:"))
async def cb_inv_accept(call: CallbackQuery):
    invite_id = int(call.data.split(":")[1])
    ok = await backend_accept_invite(call.from_user, invite_id)
    if ok:
        await call.message.edit_text("✅ Приглашение принято. Группа теперь доступна в WebApp → Общие.")
    else:
        await call.message.edit_text("⚠️ Не удалось принять приглашение (возможно уже неактуально).")
    await call.answer()


@dp.callback_query(lambda c: c.data and c.data.startswith("inv_decline:"))
async def cb_inv_decline(call: CallbackQuery):
    invite_id = int(call.data.split(":")[1])
    ok = await backend_decline_invite(call.from_user, invite_id)
    if ok:
        await call.message.edit_text("❌ Приглашение отклонено.")
    else:
        await call.message.edit_text("⚠️ Не удалось отклонить приглашение (возможно уже неактуально).")
    await call.answer()


async def main():
    logger.info("Bot starting… WEBAPP_URL=%s BACKEND_URL=%s", WEBAPP_URL, BACKEND_URL)
    await dp.start_polling(bot, allowed_updates=["message", "callback_query"], drop_pending_updates=True)


if __name__ == "__main__":
    asyncio.run(main())
