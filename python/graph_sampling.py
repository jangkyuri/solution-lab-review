"""Real graph sampling with only the standard library and SymPy."""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass
from typing import TYPE_CHECKING, Final, TypedDict

import sympy as sp
from sympy.calculus.util import continuous_domain

from compute_parser import ErrorCode, MathInputError, parse_expression

if TYPE_CHECKING:
    from collections.abc import Callable

MAX_Y: Final = 100_000_000
MAX_GRAPH_X: Final = 100_000
MIN_SAMPLE_COUNT: Final = 2
MAX_SAMPLE_COUNT: Final = 401
MIN_SEGMENT_POINTS: Final = 2
MAX_INPUT_BYTES: Final = 512 * 1024

type JsonValue = str | int | float | bool | list[JsonValue] | dict[str, JsonValue] | None


@dataclass(frozen=True, slots=True)
class SamplingInput:
    """The expression and the positions to sample in its real domain."""

    expression: str
    variable: str
    from_: float
    to: float
    count: int


class Point(TypedDict):
    """A finite real coordinate."""

    x: float
    y: float


class SamplingResult(TypedDict):
    """The wire format of continuous sample segments."""

    expression: str
    variable: str
    segments: list[list[Point]]
    discontinuities: list[float]


def real_domain(expression: sp.Expr, variable: sp.Symbol, interval: sp.Set) -> sp.Set:
    """Find a real domain while retaining restrictions of every source subtree."""
    domain = continuous_domain(expression, variable, interval)
    for subtree in sp.preorder_traversal(expression):
        match subtree:
            case sp.Expr():
                domain = domain.intersect(continuous_domain(subtree, variable, interval))
            case _:
                raise MathInputError(ErrorCode.DOMAIN)
    return domain


def _intervals(domain: sp.Set) -> list[sp.Interval]:
    """Accept only a finite union of explicitly known real intervals."""
    match domain:
        case sp.Interval():
            return [domain]
        case sp.Union():
            intervals: list[sp.Interval] = []
            for part in domain.args:
                intervals.extend(_intervals(part))
            return intervals
        case _:
            if domain == sp.S.EmptySet:
                return []
            raise MathInputError(ErrorCode.DOMAIN)


def _value_at(expr: sp.Expr, symbol: sp.Symbol, x: float) -> float | None:
    """Evaluate one safe expression at one real coordinate."""
    try:
        evaluated = expr.subs(symbol, sp.Rational(str(x))).doit().evalf(15)
        if evaluated.is_real is not True or evaluated.is_finite is not True:
            return None
        y = float(evaluated)
    except (TypeError, ValueError, OverflowError, ZeroDivisionError):
        return None
    return y if math.isfinite(y) and abs(y) <= MAX_Y else None


def _sample_interval(
    request: SamplingInput, expr: sp.Expr, symbol: sp.Symbol, interval: sp.Interval
) -> list[list[Point]]:
    """Build finite segments in one known continuity interval."""
    segments: list[list[Point]] = []
    points: list[Point] = []
    start, end = float(interval.start), float(interval.end)
    for index in range(request.count):
        x = request.from_ + (request.to - request.from_) * index / (request.count - 1)
        outside = not (start <= x <= end)
        open_end = (x == start and interval.left_open) or (x == end and interval.right_open)
        if outside or open_end:
            continue
        y = _value_at(expr, symbol, x)
        if y is None:
            if len(points) >= MIN_SEGMENT_POINTS:
                segments.append(points)
            points = []
        else:
            points.append(Point(x=x, y=y))
    if len(points) >= MIN_SEGMENT_POINTS:
        segments.append(points)
    return segments


def sample_points(request: SamplingInput) -> SamplingResult:
    """Evaluate only finite real samples inside known continuity intervals."""
    if not -MAX_GRAPH_X <= request.from_ < request.to <= MAX_GRAPH_X:
        raise MathInputError(ErrorCode.BOUNDS)
    if not MIN_SAMPLE_COUNT <= request.count <= MAX_SAMPLE_COUNT:
        raise MathInputError(ErrorCode.SAMPLES)
    expr = parse_expression(request.expression, request.variable)
    symbol = sp.Symbol(request.variable, real=True)
    try:
        domain = real_domain(expr, symbol, sp.Interval(request.from_, request.to))
        intervals = _intervals(domain)
    except NotImplementedError as error:
        raise MathInputError(ErrorCode.DOMAIN) from error
    segments: list[list[Point]] = []
    discontinuities: set[float] = set()
    for interval in intervals:
        start, end = float(interval.start), float(interval.end)
        if interval.left_open:
            discontinuities.add(start)
        if interval.right_open:
            discontinuities.add(end)
        segments.extend(_sample_interval(request, expr, symbol, interval))
    if not segments:
        raise MathInputError(ErrorCode.SAMPLES)
    return SamplingResult(
        expression=request.expression,
        variable=request.variable,
        segments=segments,
        discontinuities=sorted(discontinuities),
    )


def _read_request(
    raw: bytes, decode_json: Callable[[bytes], JsonValue] = json.loads
) -> SamplingInput:
    """Parse the bounded graph request sent by the server."""
    match decode_json(raw):
        case {
            "action": "sample",
            "expression": str(expression),
            "variable": str(variable),
            "from": (int() | float()) as lower,
            "to": (int() | float()) as upper,
            "count": int(count),
        } if not any(isinstance(value, bool) for value in (lower, upper, count)):
            return SamplingInput(expression, variable, float(lower), float(upper), count)
        case _:
            raise MathInputError(ErrorCode.SYNTAX)


def main() -> int:
    """Run one sample request through the native-extension-free worker."""
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        if len(raw) > MAX_INPUT_BYTES:
            _ = sys.stdout.write(json.dumps({"error": "계산 입력이 허용 크기를 넘었습니다."}))
            return 1
        result = sample_points(_read_request(raw))
        _ = sys.stdout.write(json.dumps(result, allow_nan=False))
    except (ValueError, ArithmeticError, OSError) as error:
        _ = sys.stdout.write(json.dumps({"error": str(error)[:2000]}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
