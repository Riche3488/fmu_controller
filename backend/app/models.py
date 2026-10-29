"""ORM 테이블. 목적함수 값은 어디에도 저장하지 않는다 (조회 시 최신 코드로 계산)."""
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON, list[Any]: JSON}


class Fmu(Base):
    __tablename__ = "fmus"
    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    file_name: Mapped[str]
    model_name: Mapped[str]
    guid: Mapped[str]
    fmi_version: Mapped[str]
    fmi_types: Mapped[list[Any]]
    generation_tool: Mapped[str]
    default_experiment: Mapped[dict[str, Any]]
    n_parameters: Mapped[int]
    n_outputs: Mapped[int]
    n_variables: Mapped[int]
    uploaded_at: Mapped[datetime] = mapped_column(default=utcnow)


class Variable(Base):
    __tablename__ = "variables"
    fmu_id: Mapped[str] = mapped_column(ForeignKey("fmus.id", ondelete="CASCADE"), primary_key=True)
    name: Mapped[str] = mapped_column(primary_key=True)
    value_reference: Mapped[int]
    causality: Mapped[str]
    variability: Mapped[str]
    type: Mapped[str]
    start: Mapped[str | None] = mapped_column(Text)  # JSON 인코딩된 값
    unit: Mapped[str | None]
    description: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (Index("ix_variables_fmu_causality", "fmu_id", "causality"),)


class Objective(Base):
    __tablename__ = "objectives"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(unique=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    kind: Mapped[str]
    name: Mapped[str]
    fmu_id: Mapped[str] = mapped_column(ForeignKey("fmus.id"), index=True)
    status: Mapped[str]
    total: Mapped[int] = mapped_column(default=0)
    completed: Mapped[int] = mapped_column(default=0)
    failed: Mapped[int] = mapped_column(default=0)
    config: Mapped[dict[str, Any]]
    objective_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    finished_at: Mapped[datetime | None]


class Run(Base):
    __tablename__ = "runs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    fmu_id: Mapped[str] = mapped_column(ForeignKey("fmus.id"), index=True)
    index: Mapped[int] = mapped_column(Integer)
    params: Mapped[dict[str, Any]]
    status: Mapped[str]
    error: Mapped[str | None] = mapped_column(Text)
    elapsed_sec: Mapped[float] = mapped_column(Float, default=0.0)
    result_path: Mapped[str | None]
