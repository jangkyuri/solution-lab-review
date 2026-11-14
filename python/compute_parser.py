"""Parse a deliberately small arithmetic language without executing input text."""

from __future__ import annotations

import ast
import math
import re
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING, Final, override

import sympy as sp

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping


class ErrorCode(StrEnum):
    """Stable error categories with separately maintained Korean messages."""

    VARIABLE = "variable"
    LENGTH = "length"
    SYNTAX = "syntax"
    COMPLEXITY = "complexity"
    REAL = "real"
    NUMBER = "number"
    NAME = "name"
    ZERO = "zero"
    EXPONENT = "exponent"
    OPERATOR = "operator"
    FUNCTION = "function"
    BOUNDS = "bounds"
    COMPARISON = "comparison"
    DOMAIN = "domain"
    SAMPLES = "samples"


MESSAGES: Final = {
    ErrorCode.VARIABLE: "변수 이름을 확인해주세요.",
    ErrorCode.LENGTH: "식은 1~300자로 입력해주세요.",
    ErrorCode.SYNTAX: "지원하는 산술식 형식이 아닙니다.",
    ErrorCode.COMPLEXITY: "식이 너무 복잡하거나 중첩이 깊습니다.",
    ErrorCode.REAL: "실수 범위에서 정의되지 않는 식입니다.",
    ErrorCode.NUMBER: "수식의 수가 허용 범위를 벗어났습니다.",
    ErrorCode.NAME: "지정한 변수와 pi, e만 사용할 수 있습니다.",
    ErrorCode.ZERO: "0으로 나눌 수 없습니다.",
    ErrorCode.EXPONENT: "지수의 크기가 허용 범위를 벗어났습니다.",
    ErrorCode.OPERATOR: "허용하지 않는 연산입니다.",
    ErrorCode.FUNCTION: "지원하지 않는 함수입니다.",
    ErrorCode.BOUNDS: "올바른 구간의 양 끝을 모두 입력해주세요.",
    ErrorCode.COMPARISON: "비교할 식을 입력해주세요.",
    ErrorCode.DOMAIN: "실수 연속 구간을 확정하지 못했습니다.",
    ErrorCode.SAMPLES: "이 구간에서 그릴 수 있는 유한한 실숫값을 얻지 못했습니다.",
}


@dataclass(frozen=True, slots=True)
class MathInputError(ValueError):
    """An input cannot safely be interpreted as a supported real expression."""

    code: ErrorCode

    @override
    def __str__(self) -> str:
        """Return the user-facing explanation for this error category."""
        return MESSAGES[self.code]


FUNCTIONS: Final = frozenset({"abs", "sqrt", "sin", "cos", "tan", "exp", "log"})
RESERVED: Final = FUNCTIONS | {"pi", "e"}
MAX_LENGTH: Final = 300
MAX_NODES: Final = 100
MAX_DEPTH: Final = 16
MAX_LITERAL: Final = 1_000_000_000
MAX_EXPONENT: Final = 16
BUILDERS: Final[Mapping[str, Callable[[sp.Expr], sp.Expr]]] = {
    "sqrt": lambda argument: sp.Pow(argument, sp.Rational(1, 2), evaluate=False),
    "abs": lambda argument: sp.Abs(argument, evaluate=False),
    "sin": lambda argument: sp.sin(argument, evaluate=False),
    "cos": lambda argument: sp.cos(argument, evaluate=False),
    "tan": lambda argument: sp.tan(argument, evaluate=False),
    "exp": lambda argument: sp.exp(argument, evaluate=False),
    "log": lambda argument: sp.log(argument, evaluate=False),
}


def parse_expression(expression: str, variable: str = "x") -> sp.Expr:
    """Construct unevaluated SymPy nodes from allowlisted Python arithmetic AST."""
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,11}", variable) or variable in RESERVED:
        raise MathInputError(ErrorCode.VARIABLE)
    if not expression.strip() or len(expression) > MAX_LENGTH:
        raise MathInputError(ErrorCode.LENGTH)
    try:
        tree = ast.parse(expression.replace("^", "**"), mode="eval")
    except (SyntaxError, RecursionError) as error:
        raise MathInputError(ErrorCode.SYNTAX) from error
    if len(list(ast.walk(tree))) > MAX_NODES:
        raise MathInputError(ErrorCode.COMPLEXITY)
    parsed = _node(tree.body, sp.Symbol(variable, real=True), 0)
    if parsed.is_real is False:
        raise MathInputError(ErrorCode.REAL)
    return parsed


def _node(node: ast.expr, variable: sp.Symbol, depth: int) -> sp.Expr:
    """Reject every node except a bounded arithmetic subset."""
    if depth > MAX_DEPTH:
        raise MathInputError(ErrorCode.COMPLEXITY)
    # AST is an open input hierarchy, so unmatched syntax is rejected explicitly.
    match node:
        case ast.Constant():
            return _number(node)
        case ast.Name(id=name):
            return _symbol(name, variable)
        case ast.UnaryOp(op=ast.UAdd(), operand=operand):
            return _node(operand, variable, depth + 1)
        case ast.UnaryOp(op=ast.USub(), operand=operand):
            return sp.Mul(-1, _node(operand, variable, depth + 1), evaluate=False)
        case ast.BinOp(left=left, op=operator, right=right):
            a = _node(left, variable, depth + 1)
            b = _node(right, variable, depth + 1)
            return _binary(operator, a, b)
        case ast.Call(func=ast.Name(id=name), args=[argument], keywords=[]):
            arg = _node(argument, variable, depth + 1)
            return _function(name, arg)
        case _:
            raise MathInputError(ErrorCode.SYNTAX)


def _number(node: ast.Constant) -> sp.Expr:
    """Accept finite bounded numeric literals and reject booleans or strings."""
    match node:
        case ast.Constant(value=bool()):
            raise MathInputError(ErrorCode.SYNTAX)
        case ast.Constant(value=int() | float() as number):
            if not math.isfinite(number) or abs(number) > MAX_LITERAL:
                raise MathInputError(ErrorCode.NUMBER)
            return sp.Rational(str(number))
        case _:
            raise MathInputError(ErrorCode.SYNTAX)


def _symbol(name: str, variable: sp.Symbol) -> sp.Expr:
    """Resolve just the original variable and the two fixed real constants."""
    match name:
        case "pi":
            return sp.pi
        case "e":
            return sp.E
        case _:
            if name != variable.name:
                raise MathInputError(ErrorCode.NAME)
            return variable


def _binary(operator: ast.operator, a: sp.Expr, b: sp.Expr) -> sp.Expr:
    """Construct an allowlisted binary operator without eager cancellation."""
    match operator:
        case ast.Add():
            return sp.Add(a, b, evaluate=False)
        case ast.Sub():
            return sp.Add(a, sp.Mul(-1, b, evaluate=False), evaluate=False)
        case ast.Mult():
            return sp.Mul(a, b, evaluate=False)
        case ast.Div():
            if b.is_zero is True:
                raise MathInputError(ErrorCode.ZERO)
            return sp.Mul(a, sp.Pow(b, -1, evaluate=False), evaluate=False)
        case ast.Pow():
            if b.is_number and (b.is_real is not True or abs(float(b)) > MAX_EXPONENT):
                raise MathInputError(ErrorCode.EXPONENT)
            return sp.Pow(a, b, evaluate=False)
        case _:
            raise MathInputError(ErrorCode.OPERATOR)


def _function(name: str, argument: sp.Expr) -> sp.Expr:
    """Call only fixed mathematical constructors, never a function from input."""
    builder = BUILDERS.get(name)
    if builder is None:
        raise MathInputError(ErrorCode.FUNCTION)
    return builder(argument)
