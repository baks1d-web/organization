from __future__ import annotations

from datetime import datetime

from .extensions import db


class TimestampMixin:
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class User(db.Model, TimestampMixin):
    id = db.Column(db.Integer, primary_key=True)
    tg_id = db.Column(db.BigInteger, unique=True, index=True, nullable=True)
    username = db.Column(db.String(64), nullable=True)
    first_name = db.Column(db.String(128), nullable=True)


class Group(db.Model, TimestampMixin):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(128), nullable=False)
    owner_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)


class GroupMember(db.Model, TimestampMixin):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    group_id = db.Column(db.Integer, db.ForeignKey("group.id"), nullable=False)
    can_tasks = db.Column(db.Boolean, default=True)
    can_finance = db.Column(db.Boolean, default=False)


class Task(db.Model, TimestampMixin):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(256), nullable=False)
    group_id = db.Column(db.Integer, db.ForeignKey("group.id"), nullable=False)
    responsible_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    deadline = db.Column(db.Date, nullable=True)
    urgent = db.Column(db.Boolean, default=False)
    done = db.Column(db.Boolean, default=False)


class FinanceItem(db.Model, TimestampMixin):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    title = db.Column(db.String(256), nullable=False)
    amount = db.Column(db.Integer, nullable=False)  # store in smallest currency unit if needed
