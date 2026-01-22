from __future__ import annotations

import logging
from datetime import datetime

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required

from ..extensions import db
from ..models import FinanceItem, Group, GroupMember, Task, User
from ..utils.decorators import log_call
from ..utils.telegram import validate_init_data

logger = logging.getLogger(__name__)

api_bp = Blueprint("api", __name__)


def ensure_default_group(user_id: int) -> int:
    """Ensure the user has a default group and is a member of it."""
    group = Group.query.filter_by(owner_id=user_id).order_by(Group.id.asc()).first()
    if not group:
        group = Group(name="Личная", owner_id=user_id)
        db.session.add(group)
        db.session.commit()

    member = GroupMember.query.filter_by(user_id=user_id, group_id=group.id).first()
    if not member:
        db.session.add(GroupMember(user_id=user_id, group_id=group.id, can_tasks=True, can_finance=True))
        db.session.commit()

    return group.id


def get_or_create_user_from_tg(tg_user: dict) -> User:
    tg_id = tg_user.get("id")
    if not tg_id:
        raise ValueError("No Telegram user id")

    user = User.query.filter_by(tg_id=tg_id).first()
    if user:
        # keep data reasonably fresh
        user.username = tg_user.get("username") or user.username
        user.first_name = tg_user.get("first_name") or user.first_name
        db.session.commit()
        return user

    user = User(
        tg_id=tg_id,
        username=tg_user.get("username"),
        first_name=tg_user.get("first_name") or "Без имени",
    )
    db.session.add(user)
    db.session.commit()
    return user


@api_bp.post("/auth/telegram")
@log_call
def auth_telegram():
    if not request.is_json:
        return jsonify({"ok": False, "error": "Expected JSON"}), 400

    init_data = request.json.get("initData")
    if not init_data:
        return jsonify({"ok": False, "error": "initData missing"}), 400

    if current_app.config.get("TELEGRAM_VALIDATE", True):
        validated = validate_init_data(init_data, current_app.config.get("BOT_TOKEN", ""))
        if not validated:
            return jsonify({"ok": False, "error": "Invalid Telegram initData"}), 403
        tg_user = validated.user
        auth_date = validated.auth_date
    else:
        # DEV mode (not recommended for prod)
        tg_user = request.json.get("debugUser") or {}
        auth_date = int(datetime.utcnow().timestamp())

    try:
        user = get_or_create_user_from_tg(tg_user)
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    group_id = ensure_default_group(user.id)

    token = create_access_token(identity=str(user.id))

    return jsonify({
        "ok": True,
        "access_token": token,
        "user": {
            "id": user.id,
            "tg_id": user.tg_id,
            "first_name": user.first_name or "",
            "username": user.username or "",
        },
        "default_group_id": group_id,
        "auth_date": auth_date,
    })


@api_bp.get("/me")
@jwt_required()
@log_call
def me():
    user_id = int(get_jwt_identity())
    user = User.query.get_or_404(user_id)
    group_id = ensure_default_group(user.id)
    return jsonify({
        "ok": True,
        "user": {
            "id": user.id,
            "tg_id": user.tg_id,
            "first_name": user.first_name or "",
            "username": user.username or "",
        },
        "default_group_id": group_id,
    })


@api_bp.post("/bot/start")
@log_call
def bot_start():
    api_key = request.headers.get("X-Bot-Api-Key", "")
    if not api_key or api_key != current_app.config.get("BOT_API_KEY", ""):
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    if not request.is_json:
        return jsonify({"ok": False, "error": "Expected JSON"}), 400

    tg_id = request.json.get("tg_id")
    if not tg_id:
        return jsonify({"ok": False, "error": "tg_id missing"}), 400

    tg_user = {
        "id": int(tg_id),
        "username": request.json.get("username"),
        "first_name": request.json.get("first_name"),
    }

    user = get_or_create_user_from_tg(tg_user)
    group_id = ensure_default_group(user.id)

    token = create_access_token(identity=str(user.id))

    return jsonify({
        "ok": True,
        "access_token": token,
        "user": {
            "id": user.id,
            "tg_id": user.tg_id,
            "first_name": user.first_name or "",
            "username": user.username or "",
        },
        "default_group_id": group_id,
    })


@api_bp.post("/groups")
@jwt_required()
@log_call
def create_group():
    user_id = int(get_jwt_identity())
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "Group name missing"}), 400

    group = Group(name=name, owner_id=user_id)
    db.session.add(group)
    db.session.commit()

    db.session.add(GroupMember(user_id=user_id, group_id=group.id, can_tasks=True, can_finance=True))
    db.session.commit()

    return jsonify({"ok": True, "id": group.id})


def require_member(user_id: int, group_id: int) -> GroupMember:
    member = GroupMember.query.filter_by(user_id=user_id, group_id=group_id).first()
    if not member:
        from flask import abort
        abort(403, description="Not a group member")
    return member


@api_bp.route("/groups/<int:gid>/tasks", methods=["GET", "POST"])
@jwt_required()
@log_call
def group_tasks(gid: int):
    user_id = int(get_jwt_identity())
    member = require_member(user_id, gid)
    if not member.can_tasks:
        return jsonify({"ok": False, "error": "No tasks permission"}), 403

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        title = (data.get("title") or "").strip()
        if not title:
            return jsonify({"ok": False, "error": "title missing"}), 400

        deadline = None
        if data.get("deadline"):
            try:
                deadline = datetime.strptime(data["deadline"], "%Y-%m-%d").date()
            except ValueError:
                return jsonify({"ok": False, "error": "deadline must be YYYY-MM-DD"}), 400

        task = Task(
            title=title,
            group_id=gid,
            responsible_id=user_id,
            deadline=deadline,
            urgent=bool(data.get("urgent", False)),
        )
        db.session.add(task)
        db.session.commit()
        return jsonify({"ok": True, "id": task.id})

    items = Task.query.filter_by(group_id=gid).order_by(Task.id.desc()).all()
    return jsonify({
        "ok": True,
        "items": [
            {
                "id": t.id,
                "title": t.title,
                "done": t.done,
                "urgent": t.urgent,
                "deadline": t.deadline.isoformat() if t.deadline else None,
            }
            for t in items
        ],
    })


@api_bp.post("/tasks/<int:tid>/done")
@jwt_required()
@log_call
def done_task(tid: int):
    user_id = int(get_jwt_identity())
    task = Task.query.get_or_404(tid)

    # Check permission via group membership
    member = require_member(user_id, task.group_id)
    if not member.can_tasks:
        return jsonify({"ok": False, "error": "No tasks permission"}), 403

    task.done = True
    db.session.commit()
    return jsonify({"ok": True})


@api_bp.route("/finance", methods=["GET", "POST"])
@jwt_required()
@log_call
def finance():
    user_id = int(get_jwt_identity())

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        title = (data.get("title") or "").strip()
        if not title:
            return jsonify({"ok": False, "error": "title missing"}), 400

        try:
            amount = int(data.get("amount"))
        except Exception:
            return jsonify({"ok": False, "error": "amount must be integer"}), 400

        item = FinanceItem(user_id=user_id, title=title, amount=amount)
        db.session.add(item)
        db.session.commit()
        return jsonify({"ok": True, "id": item.id})

    items = FinanceItem.query.filter_by(user_id=user_id).order_by(FinanceItem.id.desc()).all()
    return jsonify({
        "ok": True,
        "items": [{"id": i.id, "title": i.title, "amount": i.amount, "created_at": i.created_at.isoformat()} for i in items],
    })


@api_bp.get("/balance")
@jwt_required()
@log_call
def balance():
    user_id = int(get_jwt_identity())
    total = db.session.query(db.func.coalesce(db.func.sum(FinanceItem.amount), 0)).filter(FinanceItem.user_id == user_id).scalar()
    return jsonify({"ok": True, "balance": int(total)})
