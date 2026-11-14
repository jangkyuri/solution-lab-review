from __future__ import annotations

import pytest

from compute import CheckRequest, MathInputError, SampleRequest, check, parse_expression, sample


def test_derivative_uses_original_variable() -> None:
    # Given: a polynomial written using t.
    request = CheckRequest(operation="derivative", expression="t^3-2*t", variable="t")
    # When: the expression is differentiated.
    result = check(request)
    # Then: the exact derivative retains t.
    assert result.result == "3*t**2 - 2"
    assert result.status == "computed"


def test_definite_integral_is_exact() -> None:
    # Given: an integral over an explicit real interval.
    request = CheckRequest(operation="integral", expression="x^2", lower=0, upper=3)
    # When: the expression is integrated.
    result = check(request)
    # Then: the exact rational result is returned.
    assert result.result == "9"


def test_equivalence_requires_matching_domains() -> None:
    # Given: simplification would hide a hole at x=0.
    request = CheckRequest(operation="equivalence", expression="x/x", comparison="1")
    # When: global real equivalence is checked.
    result = check(request)
    # Then: a domain-changing identity is not verified.
    assert result.status == "undetermined"


def test_equivalence_can_use_explicit_restricted_domain() -> None:
    # Given: a canceled denominator stays nonzero on the chosen interval.
    request = CheckRequest(
        operation="equivalence", expression="x/x", comparison="1", lower=1, upper=2
    )
    # When: equivalence is checked only in that explicit interval.
    result = check(request)
    # Then: the identity is verified on that interval.
    assert result.status == "verified"


def test_divergent_integral_is_not_computed_as_finite() -> None:
    # Given: an integral crosses a nonintegrable singularity.
    request = CheckRequest(operation="integral", expression="1/x", lower=-1, upper=1)
    # When: symbolic integration returns a nonfinite or indeterminate value.
    result = check(request)
    # Then: the user is asked to inspect the singularity instead of receiving a finite claim.
    assert result.status == "undetermined"


def test_polynomial_equivalence_is_verified() -> None:
    # Given: algebraically identical polynomials on the real line.
    request = CheckRequest(operation="equivalence", expression="(x+1)^2", comparison="x^2+2*x+1")
    # When: their difference and domains are checked.
    result = check(request)
    # Then: exact equivalence is verified.
    assert result.status == "verified"


@pytest.mark.parametrize(
    "expression",
    [
        "__import__('os')",
        "x.__class__",
        "x[0]",
        "[1,2]",
        "a=2",
        "sum(x)",
        "2**999999",
        "x+y",
        "sqrt(-1)",
    ],
)
def test_parser_rejects_executable_or_unbounded_input(expression: str) -> None:
    # Given: an expression outside the arithmetic allowlist.
    # When: the parser examines its syntax tree.
    # Then: it rejects the expression before evaluation.
    with pytest.raises(MathInputError):
        _ = parse_expression(expression)


def test_polynomial_samples_match_known_points() -> None:
    # Given: a polynomial sampled on a five-point grid.
    request = SampleRequest(expression="x^2-1", from_=-2, to=2, count=5)
    # When: the curve is sampled.
    result = sample(request)
    # Then: one continuous segment contains the exact expected coordinates.
    assert [[(p.x, p.y) for p in segment] for segment in result.segments] == [
        [(-2, 3), (-1, 0), (0, -1), (1, 0), (2, 3)]
    ]


@pytest.mark.parametrize(
    ("expression", "pole"), [("1/x", 0.0), ("1/(x-0.123)", 0.123), ("tan(x)", 1.5707963267948966)]
)
def test_samples_never_bridge_a_pole(expression: str, pole: float) -> None:
    # Given: a pole that may not coincide with a grid coordinate.
    request = SampleRequest(expression=expression, from_=-2, to=2, count=200)
    # When: the graph's real continuity intervals are sampled.
    result = sample(request)
    # Then: no segment crosses the pole.
    assert all(
        not (min(p.x for p in segment) < pole < max(p.x for p in segment))
        for segment in result.segments
    )
    assert any(abs(point - pole) < 1e-9 for point in result.discontinuities)


def test_sqrt_samples_stay_in_real_domain() -> None:
    # Given: a square root whose real domain begins at zero.
    request = SampleRequest(expression="sqrt(x)", from_=-1, to=1)
    # When: its domain is sampled.
    result = sample(request)
    # Then: no imaginary branch is invented.
    assert all(point.x >= 0 for segment in result.segments for point in segment)
