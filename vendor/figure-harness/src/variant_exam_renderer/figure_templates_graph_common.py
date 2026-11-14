"""Small, strict construction helpers shared by the bounded graph templates."""

from __future__ import annotations

import math
from itertools import combinations
from typing import cast

from variant_exam_renderer.figure_recipe import FigureRecipeError, Point


def parameter_object(value: object, allowed: set[str]) -> dict[str, object]:
    """Reject unknown parameters instead of quietly changing their meaning."""
    if not isinstance(value, dict):
        msg = "graph template parameters must be an object"
        raise FigureRecipeError(msg)
    data = cast("dict[str, object]", value)
    if data.keys() - allowed:
        raise FigureRecipeError(
            f"unknown graph template parameters: {sorted(data.keys() - allowed, key=str)}"
        )
    return data


def number(value: object, name: str, *, positive: bool = False) -> float:
    """Accept finite real inputs up to 100 in magnitude, excluding booleans."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise FigureRecipeError(f"{name} must be a finite real number")
    if abs(value) > 100 or not math.isfinite(value):
        raise FigureRecipeError(f"{name} must be finite and at most 100 in magnitude")
    result = float(value)
    if positive and result < 0.01:
        raise FigureRecipeError(f"{name} must be at least 0.01")
    return result


def flag(data: dict[str, object], name: str, *, default: bool) -> bool:
    """Read a genuine boolean, never an integer or truthy string."""
    value = data.get(name, default)
    if not isinstance(value, bool):
        raise FigureRecipeError(f"{name} must be a boolean")
    return value


def number_list(value: object, name: str, minimum: int, maximum: int) -> list[float]:
    """Read a bounded JSON number array."""
    if not isinstance(value, list):
        raise FigureRecipeError(f"{name} must be an array")
    items = cast("list[object]", value)
    if not minimum <= len(items) <= maximum:
        raise FigureRecipeError(f"{name} needs {minimum}..{maximum} numbers")
    return [number(item, name) for item in items]


def pair(value: object, name: str, *, increasing: bool = False) -> Point:
    """Read two coordinates, optionally requiring a nontrivial interval."""
    values = number_list(value, name, 2, 2)
    if increasing and values[1] - values[0] < 0.01:
        raise FigureRecipeError(f"{name} must be increasing with width at least 0.01")
    return values[0], values[1]


def make_recipe(
    points: dict[str, Point],
    extents: list[Point],
    *,
    equal_aspect: bool = True,
    markers: dict[str, str] | None = None,
) -> dict[str, object]:
    """Create explicit invisible anchors and a padded view containing the axes."""
    coordinates = [*points.values(), *extents, (0.0, 0.0)]
    if any(
        not math.isfinite(value) or abs(value) > 100_000
        for point in coordinates
        for value in point
    ):
        msg = "derived graph coordinates exceed the finite construction bound 100000"
        raise FigureRecipeError(msg)
    xs, ys = [p[0] for p in coordinates], [p[1] for p in coordinates]
    xpad = max(max(xs) - min(xs), 0.1) * 0.12
    ypad = max(max(ys) - min(ys), 0.1) * 0.12
    view = [min(xs) - xpad, max(xs) + xpad, min(ys) - ypad, max(ys) + ypad]
    curve_width = max(p[0] for p in extents) - min(p[0] for p in extents)
    curve_height = max(p[1] for p in extents) - min(p[1] for p in extents)
    view_width, view_height = view[1] - view[0], view[3] - view[2]
    if (
        min(curve_width, curve_height) <= 0
        or not 1 / 12 <= curve_width / curve_height <= 12
        or not 1 / 12 <= view_width / view_height <= 12
        or curve_width < view_width * 0.1
        or curve_height < view_height * 0.1
    ):
        msg = "graph extent aspect ratio must be within 1/12..12 and occupy at least 10% of each view dimension"
        raise FigureRecipeError(msg)
    marked = [
        points[name] for name, marker in (markers or {}).items() if marker != "none"
    ]
    if any(
        math.dist(first, second) < 0.04 * max(view_width, view_height)
        for first, second in combinations(marked, 2)
    ):
        msg = "visible point markers must be separated by at least 4% of the larger view dimension"
        raise FigureRecipeError(msg)
    return {
        "schema_version": "figure_recipe_v1",
        "view": view,
        "axes": ["x", "y"],
        "equal_aspect": equal_aspect,
        "points": {name: list(point) for name, point in points.items()},
        "point_markers": {name: (markers or {}).get(name, "none") for name in points},
        "visible_annotations": [],
    }


def stroke(
    identifier: str, start: str, end: str, *, dashed: bool = False
) -> dict[str, object]:
    """Return one named solid or dashed construction segment."""
    return {
        "id": identifier,
        "from": start,
        "to": end,
        "line_style": "dashed" if dashed else "solid",
        "arrow": "none",
    }


def nonzero_strokes(
    strokes: list[dict[str, object]], points: dict[str, Point]
) -> list[dict[str, object]]:
    """Omit only zero-length guides, such as a baseline knot's vertical guide."""
    return [
        item
        for item in strokes
        if points[cast("str", item["from"])] != points[cast("str", item["to"])]
    ]
