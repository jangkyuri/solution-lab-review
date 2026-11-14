"""Format only compact graph labels with a small internal math vocabulary."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Final

from matplotlib.mathtext import MathTextParser

if TYPE_CHECKING:
    from matplotlib.axes import Axes, StyleValue

MAX_FORMULA_LENGTH: Final = 80
FORMULA_CHARACTERS: Final = re.compile(r"[A-Za-z0-9 ().,=+\-*/<>^\x27≤≥≠·]+", re.ASCII)
PLAIN_WORD: Final = re.compile(r"[A-Za-z]{2,}", re.ASCII)
NUMERIC_FRACTION: Final = re.compile(
    r"(?<![\w./])(\d{1,9})\s*/\s*(\d{1,9})(?![\w./])", re.ASCII
)
EXPLICIT_FRACTION: Final = re.compile(
    r"\\[dt]?frac\{(-?\d{1,9})\}\{(\d{1,9})\}", re.ASCII
)
EXPONENT: Final = re.compile(r"\^(-?\d{1,3})", re.ASCII)
MATH_SYMBOLS: Final = str.maketrans(
    {
        "\N{LESS-THAN OR EQUAL TO}": r"\leq ",
        "\N{GREATER-THAN OR EQUAL TO}": r"\geq ",
        "\N{NOT EQUAL TO}": r"\neq ",
        "\N{MIDDLE DOT}": r"\cdot ",
        "*": r"\cdot ",
    }
)
PARSER: Final = MathTextParser("path")


def print_label(value: str) -> tuple[str, bool]:
    """Render recognized formula labels and leave other labels in their own script."""
    literal = value.replace("\N{MINUS SIGN}", "-")
    formula = literal.strip().replace("\N{PRIME}", "'")
    if formula.startswith(r"\(") and formula.endswith(r"\)"):
        formula = formula[2:-2]
    elif formula.startswith("$") and formula.endswith("$"):
        formula = formula[1:-1]
    formula = EXPLICIT_FRACTION.sub(r"\1/\2", formula)
    formula = formula.replace(r"\leq", "≤").replace(r"\geq", "≥").replace(r"\neq", "≠")
    if (
        not formula
        or len(formula) > MAX_FORMULA_LENGTH
        or FORMULA_CHARACTERS.fullmatch(formula) is None
        or PLAIN_WORD.search(formula)
    ):
        return literal, False
    normalized = EXPONENT.sub(r"^{\1}", formula)
    normalized = NUMERIC_FRACTION.sub(r"\\frac{\1}{\2}", normalized)
    candidate = "$" + normalized.translate(MATH_SYMBOLS) + "$"
    try:
        _ = PARSER.parse(candidate)
    except ValueError:
        return literal, False
    return candidate, True


def annotate_label(
    axes: Axes, label: str, xy: tuple[float, float], **kwargs: StyleValue
) -> None:
    """Apply safe math typography to a compact annotation."""
    value, is_math = print_label(label)
    _ = axes.annotate(value, xy, parse_math=is_math, **kwargs)
