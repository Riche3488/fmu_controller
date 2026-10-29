"""resource 색인 · variant 식별 · 이전 DB 마이그레이션."""
import hashlib

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text

from app.config import Settings
from app.main import create_app
from app.models import Job, ResourceCandidate, ResourceFile, Run, Variant
from app.resources import catalog, variants
from tests.test_runner import FMU_ID, seed_fake_fmu

LOCAL = "http://127.0.0.1"


def test_variant_id_ignores_order_and_is_deterministic():
    a = variants.variant_id("f1", [("a.mat", "s1"), ("b.tir", "s2")])
    b = variants.variant_id("f1", [("b.tir", "s2"), ("a.mat", "s1")])
    assert a == b and len(a) == 16
    assert a != variants.variant_id("f2", [("a.mat", "s1"), ("b.tir", "s2")])
    assert a != variants.variant_id("f1", [("a.mat", "s1")])


def test_original_variant_is_empty_assignment():
    assert variants.original_variant_id("f1") == variants.variant_id("f1", [])
    assert variants.original_variant_id("f1") == hashlib.sha256(b"f1").hexdigest()[:16]


def test_candidate_id_format():
    cid = catalog.candidate_id("f1", "a.mat", "abc")
    assert cid == hashlib.sha256(b"f1:a.mat:abc").hexdigest()[:16]


def _session(tmp_path):
    app = create_app(Settings(data_dir=tmp_path / "data", parallel="pool", max_workers=1))
    return app


def test_index_resources_records_files_and_original_candidates(tmp_path):
    app = _session(tmp_path)
    extract = tmp_path / "ex"
    (extract / "resources" / "sub").mkdir(parents=True)
    (extract / "resources" / "a.mat").write_bytes(b"AAA")
    (extract / "resources" / "sub" / "b.tir").write_bytes(b"[T]\n")
    with TestClient(app, base_url=LOCAL):
        seed_fake_fmu(app.state.session_factory)
        with app.state.session_factory() as s:
            catalog.index_resources(s, FMU_ID, extract)
            catalog.index_resources(s, FMU_ID, extract)  # 멱등
            files = s.scalars(select(ResourceFile).where(ResourceFile.fmu_id == FMU_ID).order_by(ResourceFile.path)).all()
            assert [(f.path, f.size) for f in files] == [("a.mat", 3), ("sub/b.tir", 4)]
            assert files[0].sha256 == hashlib.sha256(b"AAA").hexdigest()
            cands = s.scalars(select(ResourceCandidate).where(ResourceCandidate.fmu_id == FMU_ID)).all()
            assert sorted((c.path, c.name, c.is_original) for c in cands) == [("a.mat", "a.mat", True), ("sub/b.tir", "b.tir", True)]
            vs = s.scalars(select(Variant).where(Variant.fmu_id == FMU_ID)).all()
            assert [(v.id, v.assignment) for v in vs] == [(variants.original_variant_id(FMU_ID), {})]


def test_ensure_variant_drops_original_candidates_and_labels(tmp_path):
    app = _session(tmp_path)
    extract = tmp_path / "ex"
    (extract / "resources").mkdir(parents=True)
    (extract / "resources" / "a.mat").write_bytes(b"AAA")
    with TestClient(app, base_url=LOCAL):
        seed_fake_fmu(app.state.session_factory)
        with app.state.session_factory() as s:
            catalog.index_resources(s, FMU_ID, extract)
            orig = catalog.candidate_id(FMU_ID, "a.mat", hashlib.sha256(b"AAA").hexdigest())
            v0 = variants.ensure_variant(s, FMU_ID, {"a.mat": orig})
            assert v0.id == variants.original_variant_id(FMU_ID)
            assert variants.variant_label(s, v0) == "원본"
            s.add(ResourceCandidate(id="c" * 16, fmu_id=FMU_ID, path="a.mat", name="a_x2.mat", sha256="s2", size=1, is_original=False))
            s.commit()
            v1 = variants.ensure_variant(s, FMU_ID, {"a.mat": "c" * 16})
            assert v1.id == variants.variant_id(FMU_ID, [("a.mat", "s2")])
            assert v1.assignment == {"a.mat": "c" * 16}
            assert variants.variant_label(s, v1) == "a.mat=a_x2.mat"
            assert variants.ensure_variant(s, FMU_ID, {"a.mat": "c" * 16}).id == v1.id


def test_upload_real_fmu_indexes_resources(client, uploaded_fmu):
    with client.app.state.session_factory() as s:
        paths = s.scalars(select(ResourceFile.path).where(ResourceFile.fmu_id == uploaded_fmu).order_by(ResourceFile.path)).all()
        assert paths == ["NEDC.mat", "RoadWithStops.mat", "StraightRoad.mat"]
        assert s.get(Variant, variants.original_variant_id(uploaded_fmu)) is not None


def test_migrates_old_db_without_variant_id(tmp_path):
    settings = Settings(data_dir=tmp_path / "data", parallel="pool", max_workers=1)
    app = create_app(settings)
    with TestClient(app, base_url=LOCAL):
        seed_fake_fmu(app.state.session_factory)
        with app.state.session_factory() as s:
            s.add(Job(id="oldjob", kind="batch", name="old", fmu_id=FMU_ID, status="done", config={}))
            s.add(Run(id="oldrun", job_id="oldjob", fmu_id=FMU_ID, index=0, params={"p": 1.0}, status="ok"))
            s.commit()
    # 이전 버전 스키마로 되돌린다
    eng = create_engine(f"sqlite:///{settings.db_path.as_posix()}")
    with eng.begin() as c:
        c.execute(text("DROP INDEX IF EXISTS ix_runs_variant_id"))
        c.execute(text("ALTER TABLE runs DROP COLUMN variant_id"))
        for t in ("resource_candidates", "resource_files", "variants"):
            c.execute(text(f"DROP TABLE {t}"))
    eng.dispose()

    app2 = create_app(settings)
    with TestClient(app2, base_url=LOCAL):
        with app2.state.session_factory() as s:
            run = s.get(Run, "oldrun")
            assert run.variant_id == variants.original_variant_id(FMU_ID)
            assert s.get(Variant, run.variant_id) is not None
