"""resource 고정/탐색 최적화 + GP 가용성 (가짜 시뮬레이터: resources/*.txt 내용을 컬럼으로 기록)."""
from app.jobs import optimize
from app.resources import variants
from tests.test_optimize import objective
from tests.test_runner import FMU_ID, SIM
from tests.test_variant_runs import cand, original, vclient  # noqa: F401
from tests.test_review_fixes import wait_job

F_A = "def evaluate(r, p):\n    return (float(r['a'].iloc[-1]) - 2) ** 2 + float(r['p'].iloc[-1]) ** 2\n"


def opt(oid, resources=None, algorithm="tpe", n_trials=10, name="ropt"):
    return {
        "name": name, "fmuId": FMU_ID, "designVars": [{"name": "p", "min": -1, "max": 1, "kind": "float"}],
        "objectives": [{"objectiveId": oid, "direction": "minimize"}], "algorithm": algorithm, "nTrials": n_trials,
        "fixedParams": {}, "sim": SIM, "recordVariables": [], "workers": 2, "runTimeoutSec": 60,
        "resources": resources or {},
    }


def runs_of(c, job_id):
    return c.get("/api/runs", params={"jobIds": job_id, "limit": 1000}).json()["items"]


def test_search_resource_trials_record_variants(vclient):  # noqa: F811
    o = objective(vclient, "res-a", F_A)
    c2 = cand(vclient, "a.txt", b"2")
    orig = original(vclient, "a.txt")
    r = vclient.post("/api/jobs/optimization", json=opt(o["id"], {"a.txt": {"mode": "search", "candidateIds": [orig, c2]}},
                                                       n_trials=16))
    assert r.status_code == 201, r.text
    done = wait_job(vclient, r.json()["id"], timeout=60)
    assert done["status"] == "done" and done["completed"] == 16, done
    runs = runs_of(vclient, done["id"])
    orig_v = variants.original_variant_id(FMU_ID)
    used = {run["variantId"] for run in runs}
    assert orig_v in used and len(used) == 2
    assert all(set(run["params"]) == {"p"} for run in runs)  # resource 선택은 params에 섞이지 않는다


def test_fixed_resource_uses_single_variant(vclient):  # noqa: F811
    o = objective(vclient, "res-a", F_A)
    c2 = cand(vclient, "a.txt", b"2")
    r = vclient.post("/api/jobs/optimization", json=opt(o["id"], {"a.txt": {"mode": "fixed", "candidateId": c2}}, n_trials=4))
    assert r.status_code == 201, r.text
    done = wait_job(vclient, r.json()["id"], timeout=60)
    used = {run["variantId"] for run in runs_of(vclient, done["id"])}
    assert len(used) == 1 and used != {variants.original_variant_id(FMU_ID)}


def test_cmaes_with_search_resource_422(vclient):  # noqa: F811
    o = objective(vclient, "res-a", F_A)
    c2 = cand(vclient, "a.txt", b"2")
    r = vclient.post("/api/jobs/optimization", json=opt(
        o["id"], {"a.txt": {"mode": "search", "candidateIds": [original(vclient, "a.txt"), c2]}}, algorithm="cmaes"))
    assert r.status_code == 422 and r.json()["detail"] == "CMA-ES는 파일 탐색(선택형 변수)을 지원하지 않습니다"


def test_cmaes_with_fixed_resource_ok(vclient):  # noqa: F811
    o = objective(vclient, "res-a", F_A)
    c2 = cand(vclient, "a.txt", b"2")
    r = vclient.post("/api/jobs/optimization", json=opt(o["id"], {"a.txt": {"mode": "fixed", "candidateId": c2}},
                                                       algorithm="cmaes", n_trials=3))
    assert r.status_code == 201, r.text
    wait_job(vclient, r.json()["id"], timeout=60)


def test_search_needs_two_candidates_422(vclient):  # noqa: F811
    o = objective(vclient, "res-a", F_A)
    r = vclient.post("/api/jobs/optimization", json=opt(
        o["id"], {"a.txt": {"mode": "search", "candidateIds": [original(vclient, "a.txt")]}}))
    assert r.status_code == 422 and r.json()["detail"] == "탐색할 후보를 2개 이상 고르세요"


def test_resource_of_other_path_422(vclient):  # noqa: F811
    o = objective(vclient, "res-a", F_A)
    cb = cand(vclient, "b.txt", b"88")
    r = vclient.post("/api/jobs/optimization", json=opt(o["id"], {"a.txt": {"mode": "fixed", "candidateId": cb}}))
    assert r.status_code == 422 and "a.txt의 후보가 아닙니다" in r.json()["detail"]


def test_gp_unavailable_422(vclient, monkeypatch):  # noqa: F811
    monkeypatch.setattr(optimize, "gp_available", lambda: False)
    o = objective(vclient, "res-a", F_A)
    r = vclient.post("/api/jobs/optimization", json=opt(o["id"], algorithm="gp"))
    assert r.status_code == 422 and r.json()["detail"] == 'GP를 쓰려면 torch를 설치하세요 (pip install -e "backend[gp]")'


def test_gp_sampler_is_built_when_available():
    import optuna

    assert isinstance(optimize.make_sampler("gp", 1, 10), optuna.samplers.GPSampler)


def test_health_reports_gp_available(vclient, monkeypatch):  # noqa: F811
    monkeypatch.setattr(optimize, "gp_available", lambda: True)
    assert vclient.get("/api/health").json()["gpAvailable"] is True
    monkeypatch.setattr(optimize, "gp_available", lambda: False)
    assert vclient.get("/api/health").json()["gpAvailable"] is False
