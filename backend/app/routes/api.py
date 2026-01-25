from __future__ import annotations

import logging
import json
from datetime import datetime, timedelta, date
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required

from ..extensions import db
from ..models import (
    FinanceItem,
    Group,
    GroupInvite,
    GroupMember,
    GroupUsernameInvite,
    GroupFinanceCategory,
    GroupPaymentMethod,
    GroupFinanceItem,
    Task,
    TaskAssignee,
    User,
    NotificationSettings,
)
from ..utils.decorators import log_call
from ..utils.telegram import validate_init_data

logger = logging.getLogger(__name__)
api_bp = Blueprint("api", __name__)

TASK_STATUSES = {
    "new": "Новая",
    "in_progress": "В работе",
    "postponed": "Отложена",
    "done": "Готова",
}


def normalize_status(value: str | None) -> str:
    if not value:
        return "new"
    v = str(value).strip().lower()
    ru_to_code = {
        "новая": "new",
        "в работе": "in_progress",
        "отложена": "postponed",
        "готова": "done",
    }
    v = ru_to_code.get(v, v)
    return v if v in TASK_STATUSES else "new"


def get_or_create_user_from_tg(tg_user: dict) -> User:
    tg_id = tg_user.get("id")
    if not tg_id:
        raise ValueError("No Telegram user id")

    user = User.query.filter_by(tg_id=tg_id).first()
    if user:
        user.username = tg_user.get("username") or user.username
        user.first_name = tg_user.get("first_name") or user.first_name
        db.session.commit()
        return user

    user = User(
        tg_id=int(tg_id),
        username=tg_user.get("username"),
        first_name=tg_user.get("first_name") or "Без имени",
    )
    db.session.add(user)
    db.session.commit()
    return user


def ensure_default_group(user_id: int) -> int:
    group = Group.query.filter_by(owner_id=user_id).order_by(Group.id.asc()).first()
    if not group:
        group = Group(name="Личная", owner_id=user_id)
        db.session.add(group)
        db.session.commit()

    m = GroupMember.query.filter_by(user_id=user_id, group_id=group.id).first()
    if not m:
        db.session.add(GroupMember(user_id=user_id, group_id=group.id, can_tasks=True, can_finance=True))
        db.session.commit()
    return group.id


def ensure_group_finance_defaults(group_id: int) -> None:
    if not GroupFinanceCategory.query.filter_by(group_id=group_id).first():
        for name in ["Продукты", "Дом", "Транспорт", "Развлечения", "Другое"]:
            db.session.add(GroupFinanceCategory(group_id=group_id, name=name))
        db.session.commit()

    if not GroupPaymentMethod.query.filter_by(group_id=group_id).first():
        for name in ["Наличные", "Безнал"]:
            db.session.add(GroupPaymentMethod(group_id=group_id, name=name))
        db.session.commit()


def require_member(user_id: int, group_id: int) -> GroupMember:
    m = GroupMember.query.filter_by(user_id=user_id, group_id=group_id).first()
    if not m:
        from flask import abort
        abort(403, description="Not a group member")
    return m


def user_to_dict(u: User) -> dict:
    return {
        "id": u.id,
        "tg_id": u.tg_id,
        "first_name": u.first_name or "",
        "username": u.username or "",
    }


def task_to_dict(t: Task) -> dict:
    assigned_by = User.query.get(t.assigned_by_id) if t.assigned_by_id else None
    responsible = User.query.get(t.responsible_id) if t.responsible_id else None

    extra_ids = [a.user_id for a in TaskAssignee.query.filter_by(task_id=t.id).all()]
    extras = User.query.filter(User.id.in_(extra_ids)).all() if extra_ids else []

    status_code = normalize_status(getattr(t, "status", "new"))
    return {
        "id": t.id,
        "title": t.title,
        "description": getattr(t, "description", "") or "",
        "done": bool(t.done),
        "status": status_code,
        "status_label": TASK_STATUSES.get(status_code, "Новая"),
        "urgent": bool(t.urgent),
        "deadline": t.deadline.isoformat() if t.deadline else None,
        "group_id": t.group_id,
        "assigned_by": user_to_dict(assigned_by) if assigned_by else None,
        "responsible": user_to_dict(responsible) if responsible else None,
        "additional_assignees": [user_to_dict(u) for u in extras],
    }


def ensure_members_for_users(group_id: int, user_ids: list[int]) -> None:
    uniq = sorted({int(x) for x in user_ids if isinstance(x, int) or str(x).isdigit()})
    if not uniq:
        return

    existing = {
        m.user_id
        for m in GroupMember.query.filter(GroupMember.group_id == group_id, GroupMember.user_id.in_(uniq)).all()
    }

    to_add = [uid for uid in uniq if uid not in existing and User.query.get(uid) is not None]
    if not to_add:
        return

    for uid in to_add:
        db.session.add(GroupMember(user_id=uid, group_id=group_id, can_tasks=True, can_finance=True))
    db.session.commit()


# ---------------- Notifications ----------------
def _tg_send_message(tg_id: int, text: str) -> None:
    token = (current_app.config.get("BOT_TOKEN") or "").strip()
    if not token:
        return

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {"chat_id": int(tg_id), "text": text}

    req = Request(
        url=url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=10) as resp:
            resp.read()
    except (HTTPError, URLError) as e:
        logger.warning("Telegram notify failed: %s", e)


def _notify_new_task(task: Task, created_by_user_id: int) -> None:
    # notify responsible + extras, but only if they have tg_id and prefs enabled
    recipients = set([task.responsible_id])
    extra_ids = [a.user_id for a in TaskAssignee.query.filter_by(task_id=task.id).all()]
    recipients.update(extra_ids)

    # do not notify creator
    recipients.discard(created_by_user_id)

    for uid in sorted(recipients):
        u = User.query.get(uid)
        if not u or not u.tg_id:
            continue

        s = NotificationSettings.get_or_create(uid)
        if not s.notify_new_task:
            continue

        dl = task.deadline.isoformat() if task.deadline else "без срока"
        text = f"🆕 Новая задача для вас:\n{task.title}\nСрок: {dl}"
        _tg_send_message(int(u.tg_id), text)


def _notify_task_updated(task: Task, updated_by_user_id: int) -> None:
    recipients = set([task.responsible_id])
    extra_ids = [a.user_id for a in TaskAssignee.query.filter_by(task_id=task.id).all()]
    recipients.update(extra_ids)

    recipients.discard(updated_by_user_id)

    for uid in sorted(recipients):
        u = User.query.get(uid)
        if not u or not u.tg_id:
            continue

        s = NotificationSettings.get_or_create(uid)
        if not s.notify_task_updates:
            continue

        dl = task.deadline.isoformat() if task.deadline else "без срока"
        text = f"✏️ Изменена задача для вас:\n{task.title}\nСтатус: {TASK_STATUSES.get(task.status, 'Новая')}\nСрок: {dl}"
        _tg_send_message(int(u.tg_id), text)


# ---------------- Auth ----------------
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
        tg_user = request.json.get("debugUser") or {}
        auth_date = int(datetime.utcnow().timestamp())

    user = get_or_create_user_from_tg(tg_user)
    group_id = ensure_default_group(user.id)
    ensure_group_finance_defaults(group_id)

    # ensure settings row exists
    NotificationSettings.get_or_create(user.id)

    token = create_access_token(identity=str(user.id))
    return jsonify({
        "ok": True,
        "access_token": token,
        "default_group_id": group_id,
        "auth_date": auth_date,
        "user": user_to_dict(user),
    })


@api_bp.get("/me")
@jwt_required()
@log_call
def me():
    user_id = int(get_jwt_identity())
    user = User.query.get_or_404(user_id)
    group_id = ensure_default_group(user.id)
    ensure_group_finance_defaults(group_id)
    NotificationSettings.get_or_create(user.id)
    return jsonify({
        "ok": True,
        "default_group_id": group_id,
        "user": user_to_dict(user),
    })


@api_bp.get("/users")
@jwt_required()
@log_call
def list_users():
    rows = User.query.order_by(User.first_name.asc(), User.id.asc()).all()
    return jsonify({"ok": True, "items": [user_to_dict(u) for u in rows]})


# --------- Settings: notifications ----------
@api_bp.get("/settings/notifications")
@jwt_required()
@log_call
def get_notification_settings():
    user_id = int(get_jwt_identity())
    s = NotificationSettings.get_or_create(user_id)
    return jsonify({"ok": True, "item": {
        "notify_new_task": bool(s.notify_new_task),
        "notify_task_updates": bool(s.notify_task_updates),
    }})


@api_bp.patch("/settings/notifications")
@jwt_required()
@log_call
def patch_notification_settings():
    user_id = int(get_jwt_identity())
    s = NotificationSettings.get_or_create(user_id)

    data = request.get_json(silent=True) or {}
    if "notify_new_task" in data:
        s.notify_new_task = bool(data.get("notify_new_task"))
    if "notify_task_updates" in data:
        s.notify_task_updates = bool(data.get("notify_task_updates"))

    s.updated_at = datetime.utcnow()
    db.session.commit()

    return jsonify({"ok": True, "item": {
        "notify_new_task": bool(s.notify_new_task),
        "notify_task_updates": bool(s.notify_task_updates),
    }})


# ---------------- Bot helper ----------------
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

    tg_user = {"id": int(tg_id), "username": request.json.get("username"), "first_name": request.json.get("first_name")}
    user = get_or_create_user_from_tg(tg_user)

    group_id = ensure_default_group(user.id)
    ensure_group_finance_defaults(group_id)
    NotificationSettings.get_or_create(user.id)

    token = create_access_token(identity=str(user.id))
    return jsonify({"ok": True, "access_token": token, "default_group_id": group_id})

@api_bp.post("/bot/invites/pending")
@log_call
def bot_invites_pending():
    api_key = request.headers.get("X-Bot-Api-Key", "")
    if not api_key or api_key != current_app.config.get("BOT_API_KEY", ""):
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    tg_id = data.get("tg_id")
    if not tg_id:
        return jsonify({"ok": False, "error": "tg_id missing"}), 400

    username = (data.get("username") or "").strip().lstrip("@").lower()

    # пользователь мог не существовать — создаётся в /bot/start, но на всякий случай:
    u = User.query.filter_by(tg_id=int(tg_id)).first()
    if not u:
        return jsonify({"ok": True, "items": []})

    if not username:
        # если у пользователя нет username — ему нечего принимать по нику
        return jsonify({"ok": True, "items": []})

    invites = GroupUsernameInvite.query.filter_by(
        target_username=username, status="pending"
    ).order_by(GroupUsernameInvite.id.desc()).all()

    items = []
    for inv in invites:
        g = Group.query.get(inv.group_id)
        if not g:
            continue
        by = User.query.get(inv.created_by_id)
        items.append({
            "id": inv.id,
            "group_id": inv.group_id,
            "group_name": g.name,
            "created_by": user_to_dict(by) if by else None,
        })

    return jsonify({"ok": True, "items": items})


@api_bp.post("/bot/invites/<int:invite_id>/accept")
@log_call
def bot_invite_accept(invite_id: int):
    api_key = request.headers.get("X-Bot-Api-Key", "")
    if not api_key or api_key != current_app.config.get("BOT_API_KEY", ""):
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    tg_id = data.get("tg_id")
    if not tg_id:
        return jsonify({"ok": False, "error": "tg_id missing"}), 400

    u = User.query.filter_by(tg_id=int(tg_id)).first()
    if not u:
        return jsonify({"ok": False, "error": "User not found"}), 404

    inv = GroupUsernameInvite.query.get_or_404(invite_id)
    if inv.status != "pending":
        return jsonify({"ok": False, "error": "Invite not pending"}), 409

    # добавить в группу
    if not GroupMember.query.filter_by(group_id=inv.group_id, user_id=u.id).first():
        db.session.add(GroupMember(user_id=u.id, group_id=inv.group_id, can_tasks=True, can_finance=True))

    inv.status = "accepted"
    inv.decided_by_id = u.id
    inv.decided_at = datetime.utcnow()

    db.session.commit()
    ensure_group_finance_defaults(inv.group_id)

    return jsonify({"ok": True, "group_id": inv.group_id})


@api_bp.post("/bot/invites/<int:invite_id>/decline")
@log_call
def bot_invite_decline(invite_id: int):
    api_key = request.headers.get("X-Bot-Api-Key", "")
    if not api_key or api_key != current_app.config.get("BOT_API_KEY", ""):
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    tg_id = data.get("tg_id")
    if not tg_id:
        return jsonify({"ok": False, "error": "tg_id missing"}), 400

    u = User.query.filter_by(tg_id=int(tg_id)).first()
    if not u:
        return jsonify({"ok": False, "error": "User not found"}), 404

    inv = GroupUsernameInvite.query.get_or_404(invite_id)
    if inv.status != "pending":
        return jsonify({"ok": False, "error": "Invite not pending"}), 409

    inv.status = "declined"
    inv.decided_by_id = u.id
    inv.decided_at = datetime.utcnow()
    db.session.commit()

    return jsonify({"ok": True})


# ---------------- Groups ----------------
@api_bp.post("/groups")
@jwt_required()
@log_call
def create_group():
    user_id = int(get_jwt_identity())
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "Group name missing"}), 400

    g = Group(name=name, owner_id=user_id)
    db.session.add(g)
    db.session.commit()

    db.session.add(GroupMember(user_id=user_id, group_id=g.id, can_tasks=True, can_finance=True))
    db.session.commit()

    ensure_group_finance_defaults(g.id)
    return jsonify({"ok": True, "id": g.id})


@api_bp.get("/groups")
@jwt_required()
@log_call
def list_groups():
    user_id = int(get_jwt_identity())

    rows = (
        db.session.query(Group, GroupMember)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .filter(GroupMember.user_id == user_id)
        .order_by(Group.id.asc())
        .all()
    )

    items = []
    for g, m in rows:
        members_count = db.session.query(db.func.count(GroupMember.id)).filter(GroupMember.group_id == g.id).scalar() or 0
        items.append({
            "id": g.id,
            "name": g.name,
            "owner_id": g.owner_id,
            "members_count": int(members_count),
            "can_tasks": bool(m.can_tasks),
            "can_finance": bool(m.can_finance),
        })
    return jsonify({"ok": True, "items": items})

@api_bp.post("/groups/<int:gid>/invites/username")
@jwt_required()
@log_call
def invite_by_username(gid: int):
    user_id = int(get_jwt_identity())
    _ = require_member(user_id, gid)

    group = Group.query.get_or_404(gid)

    # Разрешим приглашать только владельцу (как раньше с ссылкой)
    if group.owner_id != user_id:
        return jsonify({"ok": False, "error": "Only owner can invite"}), 403

    data = request.get_json(silent=True) or {}
    raw = (data.get("username") or "").strip()
    if not raw:
        return jsonify({"ok": False, "error": "username missing"}), 400

    username = raw.lstrip("@").strip().lower()
    if not username:
        return jsonify({"ok": False, "error": "invalid username"}), 400

    # уже есть активный pending на этот ник в эту группу?
    exists = GroupUsernameInvite.query.filter_by(
        group_id=gid, target_username=username, status="pending"
    ).first()
    if exists:
        return jsonify({"ok": True, "id": exists.id, "status": "pending"})

    inv = GroupUsernameInvite(
        group_id=gid,
        created_by_id=user_id,
        target_username=username,
        status="pending",
    )
    db.session.add(inv)
    db.session.commit()

    return jsonify({"ok": True, "id": inv.id, "status": "pending"})

@api_bp.get("/groups/<int:gid>/members")
@jwt_required()
@log_call
def group_members(gid: int):
    user_id = int(get_jwt_identity())
    _ = require_member(user_id, gid)

    rows = (
        db.session.query(GroupMember, User)
        .join(User, User.id == GroupMember.user_id)
        .filter(GroupMember.group_id == gid)
        .order_by(User.first_name.asc(), User.id.asc())
        .all()
    )

    return jsonify({"ok": True, "items": [user_to_dict(u) for _, u in rows]})


# ---------------- Tasks ----------------
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

        description = (data.get("description") or "").strip()
        status = normalize_status(data.get("status"))

        if data.get("deadline"):
            try:
                deadline = datetime.strptime(str(data["deadline"]), "%Y-%m-%d").date()
            except ValueError:
                return jsonify({"ok": False, "error": "deadline must be YYYY-MM-DD"}), 400
        else:
            deadline = date.today() + timedelta(days=7)

        assignee_ids = data.get("assignee_ids") or []
        try:
            assignee_ids = [int(x) for x in assignee_ids]
        except Exception:
            assignee_ids = []

        responsible_id = data.get("responsible_id")
        try:
            responsible_id = int(responsible_id) if responsible_id is not None else None
        except Exception:
            responsible_id = None

        if responsible_id is None:
            responsible_id = assignee_ids[0] if assignee_ids else user_id

        ensure_members_for_users(gid, [responsible_id] + assignee_ids)

        t = Task(
            title=title,
            group_id=gid,
            responsible_id=responsible_id,
            assigned_by_id=user_id,
            description=description,
            status=status,
            deadline=deadline,
            urgent=bool(data.get("urgent", False)),
        )
        db.session.add(t)
        db.session.commit()

        for uid in assignee_ids:
            if uid == t.responsible_id:
                continue
            if GroupMember.query.filter_by(group_id=gid, user_id=uid).first():
                db.session.add(TaskAssignee(task_id=t.id, user_id=uid))
        db.session.commit()

        # 🔔 notify
        _notify_new_task(t, created_by_user_id=user_id)

        return jsonify({"ok": True, "id": t.id})

    items = Task.query.filter_by(group_id=gid).order_by(Task.id.desc()).all()
    return jsonify({"ok": True, "items": [task_to_dict(t) for t in items]})


@api_bp.route("/tasks/<int:tid>", methods=["GET", "PATCH"])
@jwt_required()
@log_call
def task_details(tid: int):
    user_id = int(get_jwt_identity())
    t = Task.query.get_or_404(tid)

    member = require_member(user_id, t.group_id)
    if not member.can_tasks:
        return jsonify({"ok": False, "error": "No tasks permission"}), 403

    if request.method == "GET":
        return jsonify({"ok": True, "item": task_to_dict(t)})

    data = request.get_json(silent=True) or {}

    if "title" in data:
        title = (data.get("title") or "").strip()
        if title:
            t.title = title

    if "description" in data:
        t.description = (data.get("description") or "").strip()

    if "status" in data:
        t.status = normalize_status(data.get("status"))
        if t.status == "done":
            t.done = True

    if "deadline" in data:
        if not data.get("deadline"):
            t.deadline = None
        else:
            try:
                t.deadline = datetime.strptime(str(data["deadline"]), "%Y-%m-%d").date()
            except ValueError:
                return jsonify({"ok": False, "error": "deadline must be YYYY-MM-DD"}), 400

    if "done" in data:
        t.done = bool(data.get("done"))
        if t.done:
            t.status = "done"

    if "assignee_ids" in data:
        ids = data.get("assignee_ids") or []
        try:
            ids = [int(x) for x in ids]
        except Exception:
            ids = []

        ensure_members_for_users(t.group_id, ids)

        allowed: set[int] = set()
        for uid in ids:
            if uid == t.responsible_id:
                continue
            if GroupMember.query.filter_by(group_id=t.group_id, user_id=uid).first():
                allowed.add(uid)

        TaskAssignee.query.filter_by(task_id=t.id).delete()
        for uid in sorted(allowed):
            db.session.add(TaskAssignee(task_id=t.id, user_id=uid))

    db.session.commit()

    # 🔔 notify update
    _notify_task_updated(t, updated_by_user_id=user_id)

    return jsonify({"ok": True, "item": task_to_dict(t)})


# ---------------- Personal finance ----------------
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
    return jsonify({"ok": True, "items": [{"id": i.id, "title": i.title, "amount": i.amount, "created_at": i.created_at.isoformat()} for i in items]})


@api_bp.get("/balance")
@jwt_required()
@log_call
def balance():
    user_id = int(get_jwt_identity())
    total = db.session.query(db.func.coalesce(db.func.sum(FinanceItem.amount), 0)).filter(FinanceItem.user_id == user_id).scalar()
    return jsonify({"ok": True, "balance": int(total or 0)})


# ---------------- Group finance ----------------
def _gfi_to_dict(item: GroupFinanceItem) -> dict:
    cat = GroupFinanceCategory.query.get(item.category_id) if item.category_id else None
    met = GroupPaymentMethod.query.get(item.method_id) if item.method_id else None
    who = User.query.get(item.created_by_id) if item.created_by_id else None
    return {
        "id": item.id,
        "kind": item.kind,
        "amount": int(item.amount),
        "description": item.description or "",
        "category": {"id": cat.id, "name": cat.name} if cat else None,
        "method": {"id": met.id, "name": met.name} if met else None,
        "created_by": user_to_dict(who) if who else None,
        "created_at": item.created_at.isoformat(),
    }


@api_bp.route("/groups/<int:gid>/finance", methods=["GET", "POST"])
@jwt_required()
@log_call
def group_finance(gid: int):
    user_id = int(get_jwt_identity())
    m = require_member(user_id, gid)
    if not m.can_finance:
        return jsonify({"ok": False, "error": "No finance permission"}), 403

    ensure_group_finance_defaults(gid)

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        kind = (data.get("kind") or "").strip().lower()
        if kind not in {"income", "expense"}:
            return jsonify({"ok": False, "error": "kind must be income|expense"}), 400

        try:
            amount = int(data.get("amount"))
        except Exception:
            return jsonify({"ok": False, "error": "amount must be integer"}), 400
        if amount <= 0:
            return jsonify({"ok": False, "error": "amount must be > 0"}), 400

        description = (data.get("description") or "").strip()

        category_id = data.get("category_id")
        method_id = data.get("method_id")
        try:
            category_id = int(category_id) if category_id is not None else None
        except Exception:
            category_id = None
        try:
            method_id = int(method_id) if method_id is not None else None
        except Exception:
            method_id = None

        if category_id is not None and not GroupFinanceCategory.query.filter_by(id=category_id, group_id=gid).first():
            category_id = None
        if method_id is not None and not GroupPaymentMethod.query.filter_by(id=method_id, group_id=gid).first():
            method_id = None

        item = GroupFinanceItem(
            group_id=gid,
            created_by_id=user_id,
            kind=kind,
            amount=amount,
            description=description,
            category_id=category_id,
            method_id=method_id,
        )
        db.session.add(item)
        db.session.commit()
        return jsonify({"ok": True, "id": item.id, "item": _gfi_to_dict(item)})

    items = GroupFinanceItem.query.filter_by(group_id=gid).order_by(GroupFinanceItem.id.desc()).all()
    balance_val = 0
    for it in items:
        balance_val += it.amount if it.kind == "income" else -it.amount

    return jsonify({"ok": True, "balance": int(balance_val), "items": [_gfi_to_dict(i) for i in items]})


@api_bp.route("/groups/<int:gid>/finance/categories", methods=["GET", "POST", "DELETE"])
@jwt_required()
@log_call
def group_finance_categories(gid: int):
    user_id = int(get_jwt_identity())
    m = require_member(user_id, gid)
    if not m.can_finance:
        return jsonify({"ok": False, "error": "No finance permission"}), 403

    ensure_group_finance_defaults(gid)

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"ok": False, "error": "name missing"}), 400
        c = GroupFinanceCategory(group_id=gid, name=name)
        db.session.add(c)
        db.session.commit()
        return jsonify({"ok": True, "id": c.id})

    if request.method == "DELETE":
        data = request.get_json(silent=True) or {}
        cid = data.get("id")
        try:
            cid = int(cid)
        except Exception:
            return jsonify({"ok": False, "error": "id missing"}), 400

        c = GroupFinanceCategory.query.filter_by(id=cid, group_id=gid).first()
        if not c:
            return jsonify({"ok": False, "error": "not found"}), 404

        GroupFinanceItem.query.filter_by(group_id=gid, category_id=c.id).update({"category_id": None})
        db.session.delete(c)
        db.session.commit()
        return jsonify({"ok": True})

    items = GroupFinanceCategory.query.filter_by(group_id=gid).order_by(GroupFinanceCategory.id.asc()).all()
    return jsonify({"ok": True, "items": [{"id": c.id, "name": c.name} for c in items]})


@api_bp.route("/groups/<int:gid>/finance/methods", methods=["GET", "POST", "DELETE"])
@jwt_required()
@log_call
def group_finance_methods(gid: int):
    user_id = int(get_jwt_identity())
    m = require_member(user_id, gid)
    if not m.can_finance:
        return jsonify({"ok": False, "error": "No finance permission"}), 403

    ensure_group_finance_defaults(gid)

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"ok": False, "error": "name missing"}), 400
        x = GroupPaymentMethod(group_id=gid, name=name)
        db.session.add(x)
        db.session.commit()
        return jsonify({"ok": True, "id": x.id})

    if request.method == "DELETE":
        data = request.get_json(silent=True) or {}
        mid = data.get("id")
        try:
            mid = int(mid)
        except Exception:
            return jsonify({"ok": False, "error": "id missing"}), 400

        x = GroupPaymentMethod.query.filter_by(id=mid, group_id=gid).first()
        if not x:
            return jsonify({"ok": False, "error": "not found"}), 404

        GroupFinanceItem.query.filter_by(group_id=gid, method_id=x.id).update({"method_id": None})
        db.session.delete(x)
        db.session.commit()
        return jsonify({"ok": True})

    items = GroupPaymentMethod.query.filter_by(group_id=gid).order_by(GroupPaymentMethod.id.asc()).all()
    return jsonify({"ok": True, "items": [{"id": m.id, "name": m.name} for m in items]})
