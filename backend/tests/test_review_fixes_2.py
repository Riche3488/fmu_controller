"""2차 코드 리뷰 지적 재현 테스트 (resource 조합)."""
import numpy as np
import scipy.io as sio
from sqlalchemy import event

from app.models import Job, Variant
from app.resources import catalog, variants
from app.resources.preview import MAX_ROWS, TEXT_LIMIT, preview
from tests.test_optimize import objective
from tests.test_optimize_resources import F_A, opt
from tests.test_review_fixes import wait_job
from tests.test_runner import FMU_ID, batch
from tests.test_variant_runs import cand, original, run_batch, vclient  # noqa: F401


# ---- #1 variant 동시 생성 충돌이 호출자의 미커밋 작업을 버리지 않는다 ----
def test_ensure_variant_race_keeps_callers_pending_work(vclient, monkeypatch):  # noqa: F811
    c = cand(vclient, "a.txt", b"race")
    sf = vclient.app.state.session_factory
    with sf() as s:
        vid = variants.ensure_variant(s, FMU_ID, {"a.txt": c}).id  # 다른 잡이 먼저 만든 상태
    with sf() as s:
        s.add(Job(id="pendingjob", kind="batch", name="x", fmu_id=FMU_ID, status="done", config={}))
        real_get, raced = s.get, []

        def get(model, key, *a, **kw):  # 첫 조회에서는 아직 없었던 것처럼 (경쟁 상황 재현)
            if model is Variant and not raced:
                raced.append(key)
                return None
            return real_get(model, key, *a, **kw)

        monkeypatch.setattr(s, "get", get)
        v = variants.ensure_variant(s, FMU_ID, {"a.txt": c})
        assert v is not None and v.id == vid
    with sf() as s:
        assert s.get(Job, "pendingjob") is not None
        s.delete(s.get(Job, "pendingjob"))
        s.commit()


# ---- #2 MATLAB 1xN 행 벡터는 열 하나로 그리고 MAX_ROWS로 줄인다 ----
def test_mat_row_vector_is_one_downsampled_column(tmp_path):
    p = tmp_path / "v.mat"
    sio.savemat(p, {"v": np.arange(10_000.0)})  # oned_as='row' → (1, 10000)
    rows = preview(p, "v")["plot"]["rows"]
    assert len(rows) <= MAX_ROWS and all(len(r) == 1 for r in rows)
    assert rows[0] == [0.0] and rows[-1] == [9999.0]


# ---- #6 잘린 cp949 텍스트도 cp949로 읽는다 ----
def test_truncated_cp949_text_decodes(tmp_path):
    p = tmp_path / "k.txt"
    p.write_bytes(b"a" + "가".encode("cp949") * (TEXT_LIMIT // 2 + 10))  # 잘리는 지점이 2바이트 문자 중간
    out = preview(p)
    assert out["truncated"] and out["text"].startswith("a가가") and set(out["text"][1:]) == {"가"}


# ---- #3 중복 후보 id는 한 번만 센다 ----
def test_batch_dedupes_candidate_ids(vclient):  # noqa: F811
    c = cand(vclient, "a.txt", b"77")
    req = batch(name="dup", params=[{"name": "p", "mode": "list", "values": [1, 2]}])
    req["resources"] = {"a.txt": [c, c]}
    job = run_batch(vclient, req)
    assert job["total"] == 2 and job["completed"] == 2, job
    assert job["config"]["resources"] == {"a.txt": [c]}


def test_search_with_duplicate_candidates_rejected(vclient):  # noqa: F811
    o = objective(vclient, "res-a", F_A)
    c = cand(vclient, "a.txt", b"dup")
    r = vclient.post("/api/jobs/optimization", json=opt(o["id"], {"a.txt": {"mode": "search", "candidateIds": [c, c]}}))
    assert r.status_code == 422 and r.json()["detail"] == "탐색할 후보를 2개 이상 고르세요"


# ---- #5 variant 폴더 준비 실패는 variant당 한 번만 시도한다 ----
def test_failed_variant_prepared_once(vclient, monkeypatch):  # noqa: F811
    c = cand(vclient, "a.txt", b"broken-once")
    calls = []

    def broken(settings, session, v):
        calls.append(v.id)
        raise OSError("disk full")

    monkeypatch.setattr(variants, "materialize", broken)
    req = batch(name="once", params=[{"name": "p", "mode": "list", "values": [1, 2, 3, 4]}])
    req["resources"] = {"a.txt": [c]}
    job = run_batch(vclient, req)
    assert job["status"] == "done" and job["failed"] == 4, job
    assert len(calls) == 1


# ---- #8 활성 잡 확인은 설정 구조를 본다 (최적화 고정 후보 포함, 문자열 우연 일치 제외) ----
def test_config_candidate_ids():
    assert catalog.config_candidate_ids({"resources": {"a": ["c1", "c2"]}}) == {"c1", "c2"}
    assert catalog.config_candidate_ids({"resources": {"a": {"mode": "fixed", "candidateId": "c3"},
                                                       "b": {"mode": "search", "candidateIds": ["c4", "c5"]}}}) == {"c3", "c4", "c5"}
    assert catalog.config_candidate_ids({"name": "c6", "resources": {}}) == set()
    assert catalog.config_candidate_ids({}) == set()


def test_delete_candidate_not_blocked_by_unrelated_text(vclient):  # noqa: F811
    c = cand(vclient, "a.txt", b"name-match")
    with vclient.app.state.session_factory() as s:
        s.add(Job(id="namejob", kind="batch", name=c, fmu_id=FMU_ID, status="running", config={"name": c}))
        s.commit()
    try:
        assert vclient.delete(f"/api/fmus/{FMU_ID}/resources/candidates/{c}").status_code == 204
    finally:
        with vclient.app.state.session_factory() as s:
            s.get(Job, "namejob").status = "done"
            s.commit()


# ---- #9 variant 목록 이름은 variant 수와 무관한 쿼리 수로 만든다 ----
def test_variant_list_query_count_is_constant(vclient):  # noqa: F811
    for i in range(6):
        cid = cand(vclient, "b.txt", f"q{i}".encode())
        with vclient.app.state.session_factory() as s:
            variants.ensure_variant(s, FMU_ID, {"b.txt": cid, "a.txt": original(vclient, "a.txt")})
    engine = vclient.app.state.engine
    n = []
    listener = lambda *a: n.append(1)  # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)
    try:
        vs = vclient.get(f"/api/fmus/{FMU_ID}/variants").json()
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    assert len(vs) >= 7 and len(n) <= 5, (len(vs), len(n))
    assert any(v["label"] == "b.txt=q0.txt" for v in vs)

