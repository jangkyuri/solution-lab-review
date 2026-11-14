"""Bounded exact symbolic checks and continuity-aware real graph sampling."""

from __future__ import annotations

from typing import Annotated, ClassVar, Literal, assert_never

import sympy as sp
from pydantic import BaseModel, ConfigDict, Field

from compute_parser import ErrorCode, MathInputError, parse_expression
from graph_sampling import (
    MAX_GRAPH_X,
    MAX_SAMPLE_COUNT,
    MIN_SAMPLE_COUNT,
    SamplingInput,
    real_domain,
    sample_points,
)

__all__ = [
    "CheckRequest",
    "CheckResult",
    "MathInputError",
    "Point",
    "SampleRequest",
    "SampleResult",
    "check",
    "parse_expression",
    "sample",
]

Expression = Annotated[str, Field(min_length=1, max_length=300)]
Variable = Annotated[str, Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,11}$")]
Operation = Literal["simplify", "derivative", "integral", "equivalence"]
Status = Literal["computed", "verified", "different", "undetermined"]


class Point(BaseModel):
    """A finite real plot coordinate."""

    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True, allow_inf_nan=False)
    x: float
    y: float


class CheckRequest(BaseModel):
    """One bounded symbolic operation on the original real variable."""

    model_config: ClassVar[ConfigDict] = ConfigDict(
        frozen=True, extra="forbid", allow_inf_nan=False
    )
    action: Literal["check"] = "check"
    operation: Operation
    expression: Expression
    variable: Variable = "x"
    comparison: Expression | None = None
    lower: float | None = Field(default=None, ge=-100_000, le=100_000)
    upper: float | None = Field(default=None, ge=-100_000, le=100_000)


class CheckResult(BaseModel):
    """A calculated result distinguished from verified equivalence."""

    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)
    operation: Operation
    expression: str
    variable: str
    result: str
    latex: str
    status: Status
    details: str


class SampleRequest(BaseModel):
    """A bounded real plotting interval."""

    model_config: ClassVar[ConfigDict] = ConfigDict(
        frozen=True, extra="forbid", allow_inf_nan=False, populate_by_name=True
    )
    action: Literal["sample"] = "sample"
    expression: Expression
    variable: Variable = "x"
    from_: float = Field(validation_alias="from", ge=-MAX_GRAPH_X, le=MAX_GRAPH_X)
    to: float = Field(ge=-MAX_GRAPH_X, le=MAX_GRAPH_X)
    count: int = Field(default=201, ge=MIN_SAMPLE_COUNT, le=MAX_SAMPLE_COUNT)


class SampleResult(BaseModel):
    """Separate continuous segments; never connect points across a gap."""

    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)
    expression: str
    variable: str
    segments: list[list[Point]]
    discontinuities: list[float]


def _equivalence(
    request: CheckRequest, expr: sp.Expr, symbol: sp.Symbol, domain: sp.Set, interval: sp.Set
) -> tuple[sp.Expr, Status, str]:
    """Verify identities only when their original real domains match."""
    if request.comparison is None:
        raise MathInputError(ErrorCode.COMPARISON)
    other = parse_expression(request.comparison, request.variable)
    other_domain = real_domain(other, symbol, interval)
    value = sp.simplify(expr - other)
    if domain != other_domain:
        return value, "undetermined", f"두 식의 실수 정의역이 다릅니다: {domain} / {other_domain}."
    if value.is_zero is True:
        return value, "verified", f"같은 실수 정의역 {domain}에서 차가 기호적으로 0입니다."
    if value.is_zero is False:
        return (
            value,
            "different",
            "두 식의 차가 0인 항등식이 아닙니다. 개별 해의 존재와는 구분합니다.",
        )
    return value, "undetermined", "기호 계산만으로 두 식의 동치를 판정하지 못했습니다."


def _integral(
    request: CheckRequest, expr: sp.Expr, symbol: sp.Symbol
) -> tuple[sp.Expr, Status, str]:
    """Compute an integral while explicitly reporting unresolved or divergent results."""
    if request.lower is None or request.upper is None:
        value = sp.integrate(expr, symbol)
        details = "부정적분의 적분상수는 별도이며 각 연결된 정의역에서 읽어야 합니다."
    else:
        bounds = (symbol, sp.Rational(str(request.lower)), sp.Rational(str(request.upper)))
        value = sp.integrate(expr, bounds)
        details = "입력한 실수 구간의 정적분 계산 결과입니다."
    if value.has(sp.Integral, sp.nan, sp.oo, -sp.oo, sp.zoo) or value.is_finite is False:
        return (
            value,
            "undetermined",
            "유한한 닫힌 형태를 확인하지 못했습니다. 특이점·구간을 검토해주세요.",
        )
    return value, "computed", details


def check(request: CheckRequest) -> CheckResult:
    """Return exact calculations without promoting numerical evidence to proof."""
    expr = parse_expression(request.expression, request.variable)
    symbol = sp.Symbol(request.variable, real=True)
    if (request.lower is None) != (request.upper is None):
        raise MathInputError(ErrorCode.BOUNDS)
    interval = sp.S.Reals
    if request.lower is not None and request.upper is not None:
        interval = sp.Interval(min(request.lower, request.upper), max(request.lower, request.upper))
    status: Status = "computed"
    details = "실수 범위의 기호 계산 결과입니다. 전체 풀이를 검증한 것은 아닙니다."
    try:
        domain = real_domain(expr, symbol, interval)
        if domain == sp.S.EmptySet:
            raise MathInputError(ErrorCode.DOMAIN)
        match request.operation:
            case "simplify":
                value = sp.simplify(expr)
                details += f" 원래 식의 정의역: {domain}."
            case "derivative":
                value = sp.diff(expr, symbol)
                details += f" 원래 정의역: {domain}. 미분 가능성의 경계는 별도 확인해야 합니다."
            case "integral":
                value, status, details = _integral(request, expr, symbol)
            case "equivalence":
                value, status, details = _equivalence(request, expr, symbol, domain, interval)
            case _:
                assert_never(request.operation)
    except NotImplementedError:
        value = expr
        status = "undetermined"
        details = "지원하는 기호 계산으로 실수 정의역·결과를 확정하지 못했습니다."
    return CheckResult(
        operation=request.operation,
        expression=request.expression,
        variable=request.variable,
        result=str(value),
        latex=sp.latex(value),
        status=status,
        details=details,
    )


def sample(request: SampleRequest) -> SampleResult:
    """Keep the full worker's sampling interface on the shared sampling implementation."""
    inputs = SamplingInput(
        request.expression, request.variable, request.from_, request.to, request.count
    )
    return SampleResult.model_validate(sample_points(inputs))
