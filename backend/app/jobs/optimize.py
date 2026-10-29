"""Optuna ask/tell 최적화. 제출 시점의 목적함수 코드 스냅샷으로 평가하고, 값은 DB에 쓰지 않는다."""
from collections.abc import Iterator

import optuna
from optuna.trial import TrialState

from ..models import Run
from ..objectives.worker import EvalItem
from ..schemas import OptimizationRequest

optuna.logging.set_verbosity(optuna.logging.WARNING)


def make_sampler(algorithm: str, n_objectives: int, n_trials: int, seed: int = 0) -> optuna.samplers.BaseSampler:
    if algorithm == "cmaes":
        return optuna.samplers.CmaEsSampler(seed=seed)
    if algorithm == "random":
        return optuna.samplers.RandomSampler(seed=seed)
    if algorithm == "nsga2":
        # 작은 trial 예산에서도 세대가 진행되도록 개체 수를 trial 수에 맞춘다
        return optuna.samplers.NSGAIISampler(seed=seed, population_size=max(4, min(50, n_trials // 5)))
    return optuna.samplers.TPESampler(seed=seed, multivariate=n_objectives > 1)


class Optimization:
    """잡 스레드 안에서 JobManager.run_cases에 지연 케이스 생성기와 완료 콜백을 제공한다."""

    def __init__(self, req: OptimizationRequest, codes: dict[str, str], evaluator):
        self.req = req
        self.codes = codes  # objective_id -> 스냅샷 코드 (req.objectives 순서)
        self.evaluator = evaluator
        self.study = optuna.create_study(
            directions=[o.direction for o in req.objectives],
            sampler=make_sampler(req.algorithm, len(req.objectives), req.n_trials),
        )
        self._trials: dict[int, optuna.Trial] = {}

    def cases(self, case_cls) -> Iterator:
        for _ in range(self.req.n_trials):
            trial = self.study.ask()
            params = {}
            for d in self.req.design_vars:
                if d.kind == "int":
                    params[d.name] = float(trial.suggest_int(d.name, int(d.min), int(d.max)))
                else:
                    params[d.name] = trial.suggest_float(d.name, d.min, d.max)
            self._trials[trial.number] = trial
            yield case_cls(trial.number, {**self.req.fixed_params, **params})

    def on_done(self, case, run: Run) -> None:
        trial = self._trials.pop(case.index)
        if run.status != "ok" or not run.result_path:
            self.study.tell(trial, state=TrialState.FAIL)
            return
        item = EvalItem(run_id=run.id, result_path=run.result_path, params=run.params)
        values = []
        for o in self.req.objectives:
            r = self.evaluator.evaluate(self.codes[o.objective_id], [item])[run.id]
            if r.value is None:
                self.study.tell(trial, state=TrialState.FAIL)
                return
            values.append(r.value)
        self.study.tell(trial, values)
