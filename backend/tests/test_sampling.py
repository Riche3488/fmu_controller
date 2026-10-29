import pytest

from app.jobs.sampling import generate_cases
from app.schemas import SweepList, SweepRange

list3 = SweepList(name="a", mode="list", values=[1, 2, 3])
list3b = SweepList(name="b", mode="list", values=[10, 20, 30])
range4 = SweepRange(name="b", mode="range", min=0, max=3, steps=4)
range_a = SweepRange(name="a", mode="range", min=-1, max=1, steps=2)
range_c = SweepRange(name="c", mode="range", min=100, max=200, steps=2)


def test_grid_cases():
    cases = generate_cases([list3, range4], "grid", None)
    assert len(cases) == 12
    assert cases[0] == {"a": 1.0, "b": 0.0}
    assert cases[1] == {"a": 1.0, "b": 1.0}
    assert cases[-1] == {"a": 3.0, "b": 3.0}


def test_zip_cases():
    assert generate_cases([list3, list3b], "zip", None) == [{"a": 1, "b": 10}, {"a": 2, "b": 20}, {"a": 3, "b": 30}]


def test_zip_unequal_lengths():
    with pytest.raises(ValueError, match="zip 방식은 모든 파라미터의 값 개수가 같아야 합니다"):
        generate_cases([list3, range4], "zip", None)


def test_lhs_bounds_and_stratification():
    cases = generate_cases([range_a, range_c], "lhs", 50)
    assert len(cases) == 50
    assert all(-1 <= c["a"] <= 1 and 100 <= c["c"] <= 200 for c in cases)
    # LHS: 각 구간(1/50)마다 정확히 하나의 샘플
    bins = sorted(int((c["a"] + 1) / 2 * 50) for c in cases)
    assert bins == list(range(50))


def test_random_is_seeded():
    assert generate_cases([range_a], "random", 5, seed=1) == generate_cases([range_a], "random", 5, seed=1)
    assert generate_cases([range_a], "random", 5, seed=1) != generate_cases([range_a], "random", 5, seed=2)


def test_lhs_rejects_list_params():
    with pytest.raises(ValueError, match="LHS/random 방식은 range 파라미터만 지원합니다"):
        generate_cases([list3], "lhs", 10)


def test_lhs_requires_n_samples():
    with pytest.raises(ValueError, match="샘플 수"):
        generate_cases([range_a], "lhs", None)


def test_no_params():
    assert generate_cases([], "grid", None) == []
