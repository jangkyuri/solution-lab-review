"""Bounded arithmetic evaluator for declared curves; never executes input code."""

from __future__ import annotations

import ast
import math
from collections.abc import Callable
from typing import Final

from variant_exam_renderer.figure_recipe import FigureRecipeError, RecipeCurve

FUNCTIONS: Final[dict[str, Callable[[float], float]]] = {
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "asin": math.asin,
    "acos": math.acos,
    "atan": math.atan,
    "sqrt": math.sqrt,
    "exp": math.exp,
    "log": math.log,
    "log10": math.log10,
    "abs": abs,
}
CONSTANTS: Final = {"pi": math.pi, "e": math.e}


def parse_expression(expression: str) -> ast.Expression:
    """Accept only small arithmetic expressions in x and named math functions."""
    if len(expression) > 500:
        msg = "curve expression exceeds 500 characters"
        raise FigureRecipeError(msg)
    try:
        tree = ast.parse(expression, mode="eval")
    except (SyntaxError, RecursionError) as exc:
        msg = "invalid curve expression"
        raise FigureRecipeError(msg) from exc
    nodes = tuple(ast.walk(tree))
    if len(nodes) > 100:
        msg = "curve expression exceeds 100 syntax nodes"
        raise FigureRecipeError(msg)
    for node in nodes:
        if isinstance(node, ast.Name):
            if node.id not in {"x", *CONSTANTS, *FUNCTIONS} or (
                node.id in FUNCTIONS
                and not any(
                    isinstance(parent, ast.Call) and parent.func is node
                    for parent in nodes
                )
            ):
                raise FigureRecipeError(f"unknown expression name {node.id}")
        elif (
            isinstance(node, ast.BinOp)
            and isinstance(node.op, ast.Pow)
            and isinstance(node.right, ast.Constant)
            and isinstance(node.right.value, (int, float))
            and abs(node.right.value) > 100
        ):
            msg = "expression power exceeds 100"
            raise FigureRecipeError(msg)
        elif isinstance(node, ast.Call):
            if (
                not isinstance(node.func, ast.Name)
                or node.func.id not in FUNCTIONS
                or len(node.args) != 1
                or node.keywords
            ):
                msg = "only approved one-argument math calls are allowed"
                raise FigureRecipeError(msg)
        elif isinstance(node, ast.Constant):
            if (
                isinstance(node.value, bool)
                or not isinstance(node.value, (int, float))
                or abs(node.value) > 1e6
                or not math.isfinite(node.value)
            ):
                msg = "invalid expression constant"
                raise FigureRecipeError(msg)
        elif not isinstance(
            node,
            (
                ast.Expression,
                ast.BinOp,
                ast.UnaryOp,
                ast.Load,
                ast.Add,
                ast.Sub,
                ast.Mult,
                ast.Div,
                ast.Pow,
                ast.USub,
                ast.UAdd,
            ),
        ):
            raise FigureRecipeError(
                f"unsupported expression syntax {type(node).__name__}"
            )
    return tree


def _evaluate(node: ast.AST, x: float) -> float:
    if isinstance(node, ast.Expression):
        return _evaluate(node.body, x)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.Name):
        return x if node.id == "x" else CONSTANTS[node.id]
    if isinstance(node, ast.UnaryOp):
        value = _evaluate(node.operand, x)
        return -value if isinstance(node.op, ast.USub) else value
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        return FUNCTIONS[node.func.id](_evaluate(node.args[0], x))
    if isinstance(node, ast.BinOp):
        left, right = _evaluate(node.left, x), _evaluate(node.right, x)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            return left / right
        if isinstance(node.op, ast.Pow) and abs(right) <= 100:
            return math.pow(left, right)
    msg = "unsupported expression operation"
    raise FigureRecipeError(msg)


def curve_function(curve: RecipeCurve) -> Callable[[float], float]:
    """Compile a data recipe into a bounded evaluator, with undefined gaps as NaN."""
    tree = parse_expression(curve.expression) if curve.expression is not None else None

    def evaluate(x: float) -> float:
        try:
            if tree is not None:
                value = _evaluate(tree, x)
            else:
                value = 0.0
                for coefficient in reversed(curve.coefficients):
                    value = value * x + coefficient
        except (ValueError, OverflowError, ZeroDivisionError):
            return math.nan
        return value if math.isfinite(value) else math.nan

    return evaluate
