from __future__ import annotations

import secrets
from datetime import datetime

from .extensions import db


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    tg_id = db.Column(db.BigInteger, unique=True, nullable=True, index=True)
    username = db.Column(db.String(128), nullable=True)
    first_name = db.Column(db.String(128), nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class Group(db.Model):
    __tablename__ = "groups"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(128), nullable=False)
    owner_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class GroupMember(db.Model):
    __tablename__ = "group_members"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=False, index=True)

    can_tasks = db.Column(db.Boolean, default=True, nullable=False)
    can_finance = db.Column(db.Boolean, default=True, nullable=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class GroupInvite(db.Model):
    __tablename__ = "group_invites"

    id = db.Column(db.Integer, primary_key=True)
    token = db.Column(db.String(64), unique=True, nullable=False, index=True)

    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=False, index=True)
    created_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    used_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    used_at = db.Column(db.DateTime, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    @staticmethod
    def new_token() -> str:
        return secrets.token_urlsafe(24)


class Task(db.Model):
    __tablename__ = "tasks"

    id = db.Column(db.Integer, primary_key=True)

    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=False, index=True)

    title = db.Column(db.String(256), nullable=False)
    description = db.Column(db.Text, nullable=True)

    status = db.Column(db.String(32), default="new", nullable=False)
    done = db.Column(db.Boolean, default=False, nullable=False)
    urgent = db.Column(db.Boolean, default=False, nullable=False)

    deadline = db.Column(db.Date, nullable=True)

    responsible_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    assigned_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class TaskAssignee(db.Model):
    __tablename__ = "task_assignees"

    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey("tasks.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class FinanceItem(db.Model):
    __tablename__ = "finance_items"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)

    title = db.Column(db.String(256), nullable=False)
    amount = db.Column(db.Integer, nullable=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class GroupFinanceCategory(db.Model):
    __tablename__ = "group_finance_categories"

    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=False, index=True)
    name = db.Column(db.String(128), nullable=False)


class GroupPaymentMethod(db.Model):
    __tablename__ = "group_payment_methods"

    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=False, index=True)
    name = db.Column(db.String(128), nullable=False)


class GroupFinanceItem(db.Model):
    __tablename__ = "group_finance_items"

    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=False, index=True)
    created_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    kind = db.Column(db.String(16), nullable=False)  # income | expense
    amount = db.Column(db.Integer, nullable=False)
    description = db.Column(db.Text, nullable=True)

    category_id = db.Column(db.Integer, db.ForeignKey("group_finance_categories.id"), nullable=True)
    method_id = db.Column(db.Integer, db.ForeignKey("group_payment_methods.id"), nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class NotificationSettings(db.Model):
    __tablename__ = "notification_settings"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), unique=True, nullable=False, index=True)

    notify_new_task = db.Column(db.Boolean, default=True, nullable=False)
    notify_task_updates = db.Column(db.Boolean, default=True, nullable=False)

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    @staticmethod
    def get_or_create(user_id: int) -> "NotificationSettings":
        row = NotificationSettings.query.filter_by(user_id=user_id).first()
        if row:
            return row
        row = NotificationSettings(user_id=user_id, notify_new_task=True, notify_task_updates=True)
        db.session.add(row)
        db.session.commit()
        return row

class GroupUsernameInvite(db.Model):
    __tablename__ = "group_username_invites"

    id = db.Column(db.Integer, primary_key=True)

    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=False, index=True)
    created_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    target_username = db.Column(db.String(128), nullable=False, index=True)  # lower, without "@"

    status = db.Column(db.String(16), default="pending", nullable=False)  # pending|accepted|declined

    decided_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    decided_at = db.Column(db.DateTime, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


# ---------------- Habits ----------------
class Habit(db.Model):
    __tablename__ = "habits"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)

    title = db.Column(db.String(256), nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class HabitCheck(db.Model):
    __tablename__ = "habit_checks"

    id = db.Column(db.Integer, primary_key=True)
    habit_id = db.Column(db.Integer, db.ForeignKey("habits.id"), nullable=False, index=True)
    day = db.Column(db.Date, nullable=False, index=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        db.UniqueConstraint("habit_id", "day", name="uq_habit_day"),
    )
