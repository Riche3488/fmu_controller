"""최종 리뷰 지적 재현 테스트 (resource 기능)."""
import io

import numpy as np
import scipy.io as sio

from app.models import Job
from app.resources import variants
from tests.test_resources_api import resources, upload
from tests.test_review_fixes import wait_job
from tests.test_runner import FMU_ID, batch
from tests.test_variant_runs import cand, original, vclient  # noqa: F401


# ---- #1 업로드한 .mat 후보도 mat 미리보기 (저장 파일명에는 확장자가 없다) ----
def test_preview_uploaded_mat_candidate(client, uploaded_fmu):
    buf = io.BytesIO()
    sio.savemat(buf, {"table": np.arange(12.0).reshape(4, 3)}, format="4")
    cid = upload(client, uploaded_fmu, "NEDC.mat", "nedc_edit.mat", buf.getvalue()).json()["id"]
    p = client.get(f"/api/fmus/{uploaded_fmu}/resources/candidates/{cid}/preview", params={"var": "table"}).json()
    assert p["kind"] == "mat", p
    assert p["plot"]["rows"][1] == [3.0, 4.0, 5.0]


# ---- #2 variant 준비 실패: 슬롯을 반납하고 그 케이스만 실패로 기록 ----
def test_materialize_failure_records_failed_run_and_releases_slot(vclient, monkeypatch):  # noqa: F811
    mgr = vclient.app.state.jobs
    free_before = mgr._slots._value
    c9 = cand(vclient, "a.txt", b"9")

    def broken(settings, session, v):
        if v.assignment:
            raise OSError("disk full")
        return settings.data_dir / "extract" / v.fmu_id

    monkeypatch.setattr(variants, "materialize", broken)
    req = batch(name="broken", params=[{"name": "p", "mode": "list", "values": [1]}])
    req["resources"] = {"a.txt": [original(vclient, "a.txt"), c9]}
    job = vclient.post("/api/jobs/batch", json=req).json()
    done = wait_job(vclient, job["id"])
    assert done["status"] == "done" and done["completed"] == 1 and done["failed"] == 1, done
    runs = vclient.get("/api/runs", params={"jobIds": job["id"]}).json()["items"]
    assert any(r["error"] and "disk full" in r["error"] for r in runs)
    assert mgr._slots._value == free_before


# ---- #3 실행 중/대기 중 잡이 쓰는 후보는 삭제할 수 없다 ----
def test_delete_candidate_used_by_active_job_409(vclient):  # noqa: F811
    c8 = cand(vclient, "a.txt", b"8")
    with vclient.app.state.session_factory() as s:
        s.add(Job(id="activejob", kind="batch", name="x", fmu_id=FMU_ID, status="running",
                  config={"resources": {"a.txt": [c8]}}))
        s.commit()
    try:
        r = vclient.delete(f"/api/fmus/{FMU_ID}/resources/candidates/{c8}")
        assert r.status_code == 409 and r.json()["detail"] == "실행 중이거나 대기 중인 잡이 이 후보를 쓰고 있어 삭제할 수 없습니다"
    finally:
        with vclient.app.state.session_factory() as s:
            s.get(Job, "activejob").status = "done"
            s.commit()
    assert vclient.delete(f"/api/fmus/{FMU_ID}/resources/candidates/{c8}").status_code == 204


# ---- #4 같은 이름으로 여러 번 올린 후보도 조합 이름이 구분된다 ----
def test_variant_labels_disambiguate_same_names(client, uploaded_fmu):
    a = upload(client, uploaded_fmu, "NEDC.mat", "NEDC.mat", b"edit-1").json()
    b = upload(client, uploaded_fmu, "NEDC.mat", "NEDC.mat", b"edit-2").json()
    with client.app.state.session_factory() as s:
        va = variants.ensure_variant(s, uploaded_fmu, {"NEDC.mat": a["id"]})
        vb = variants.ensure_variant(s, uploaded_fmu, {"NEDC.mat": b["id"]})
        la, lb = variants.variant_label(s, va), variants.variant_label(s, vb)
    assert la != lb
    assert la == f"NEDC.mat=NEDC.mat[{a['sha256'][:8]}]" and lb == f"NEDC.mat=NEDC.mat[{b['sha256'][:8]}]"
    # 이름이 겹치지 않으면 그대로
    c = upload(client, uploaded_fmu, "NEDC.mat", "unique.mat", b"edit-3").json()
    with client.app.state.session_factory() as s:
        assert variants.variant_label(s, variants.ensure_variant(s, uploaded_fmu, {"NEDC.mat": c["id"]})) == "NEDC.mat=unique.mat"
    assert {x["name"] for x in resources(client, uploaded_fmu)["NEDC.mat"]["candidates"]} >= {"NEDC.mat", "unique.mat"}
