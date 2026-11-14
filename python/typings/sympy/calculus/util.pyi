# Types for SymPy's real continuity-domain analysis.

from sympy import Expr, Set, Symbol

def continuous_domain(expression: Expr, symbol: Symbol, domain: Set) -> Set: ...
