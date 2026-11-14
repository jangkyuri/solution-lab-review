"""Bounded constructions for textbook solids of revolution.

This module expands semantic dimensions to a fixed oblique line drawing. It
does not infer visible dimension text: template envelopes supply annotations.
"""

from __future__ import annotations

import math
from typing import cast

from variant_exam_renderer.figure_recipe import RECIPE_VERSION, FigureRecipeError

_MAX_DIMENSION = 100.0
_ELLIPSE_DEPTH = 0.22


def _parameters(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        msg = "template parameters must be an object"
        raise FigureRecipeError(msg)
    data = cast("dict[object, object]", value)
    required = {"cone_radius", "cone_height", "cylinder_height"}
    if set(data) != required:
        msg = f"cone_inscribed_cylinder requires exactly {sorted(required)}"
        raise FigureRecipeError(msg)
    if any(not isinstance(key, str) for key in data):
        msg = "template parameter names must be strings"
        raise FigureRecipeError(msg)
    return cast("dict[str, object]", data)


def _dimension(data: dict[str, object], name: str) -> float:
    value = data[name]
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not 0 < value <= _MAX_DIMENSION
        or not math.isfinite(value)
    ):
        msg = f"{name} must be a finite number in (0, {_MAX_DIMENSION}]"
        raise FigureRecipeError(msg)
    return float(value)


def _arc(
    identifier: str,
    *,
    radius: float,
    height: float,
    back: bool,
    hidden: bool,
) -> dict[str, object]:
    return {
        "id": identifier,
        "center": [0.0, height],
        "radii": [radius, _ELLIPSE_DEPTH * radius],
        "rotation_degrees": 0,
        "start_degrees": 0 if back else 180,
        "end_degrees": 180 if back else 360,
        "line_style": "dashed" if hidden else "solid",
    }


def _stroke(
    identifier: str, start: str, end: str, *, hidden: bool = False
) -> dict[str, object]:
    return {
        "id": identifier,
        "from": start,
        "to": end,
        "line_style": "dashed" if hidden else "solid",
        "arrow": "none",
    }


def build_cone_inscribed_cylinder(parameters: object) -> dict[str, object]:
    """Draw a coaxial cylinder based on a cone's base.

    All three dimensions are required and in (0, 100]; cylinder_height must be
    strictly below cone_height. Its radius is derived by similarity as
    ``cone_radius * (cone_height - cylinder_height) / cone_height``.

    This fixed oblique projection has front solid/rear dashed bottom rims.
    Stable label targets include cone_apex, cone_base_center,
    cylinder_top_center, cone_height, cone_base_radius, and all six arc ids.
    """
    data = _parameters(parameters)
    cone_radius = _dimension(data, "cone_radius")
    cone_height = _dimension(data, "cone_height")
    cylinder_height = _dimension(data, "cylinder_height")
    if cylinder_height >= cone_height:
        msg = "cylinder_height must be strictly below cone_height"
        raise FigureRecipeError(msg)
    cylinder_radius = cone_radius * (cone_height - cylinder_height) / cone_height
    if not math.isfinite(cylinder_radius) or cylinder_radius <= 0:
        msg = "cylinder radius is too small for this projection"
        raise FigureRecipeError(msg)

    points = {
        "cone_apex": [0.0, cone_height],
        "cone_base_center": [0.0, 0.0],
        "cone_base_left": [-cone_radius, 0.0],
        "cone_base_right": [cone_radius, 0.0],
        "cylinder_top_center": [0.0, cylinder_height],
        "cylinder_top_left": [-cylinder_radius, cylinder_height],
        "cylinder_top_right": [cylinder_radius, cylinder_height],
        "cylinder_base_left": [-cylinder_radius, 0.0],
        "cylinder_base_right": [cylinder_radius, 0.0],
    }
    x_margin = 0.16 * cone_radius
    y_margin = 0.12 * max(cone_height, cone_radius)
    return {
        "schema_version": RECIPE_VERSION,
        "view": [
            -cone_radius - x_margin,
            cone_radius + x_margin,
            -_ELLIPSE_DEPTH * cone_radius - y_margin,
            cone_height + y_margin,
        ],
        "axes": [],
        "equal_aspect": True,
        "points": points,
        "point_markers": {},
        "strokes": [
            _stroke("cone_side_left", "cone_apex", "cone_base_left"),
            _stroke("cone_side_right", "cone_apex", "cone_base_right"),
            _stroke("cone_height", "cone_apex", "cone_base_center", hidden=True),
            _stroke("cone_base_radius", "cone_base_center", "cone_base_right"),
            _stroke("cylinder_side_left", "cylinder_top_left", "cylinder_base_left"),
            _stroke("cylinder_side_right", "cylinder_top_right", "cylinder_base_right"),
        ],
        "ellipse_arcs": [
            _arc(
                "cone_base_back",
                radius=cone_radius,
                height=0,
                back=True,
                hidden=True,
            ),
            _arc(
                "cone_base_front",
                radius=cone_radius,
                height=0,
                back=False,
                hidden=False,
            ),
            _arc(
                "cylinder_top_back",
                radius=cylinder_radius,
                height=cylinder_height,
                back=True,
                hidden=False,
            ),
            _arc(
                "cylinder_top_front",
                radius=cylinder_radius,
                height=cylinder_height,
                back=False,
                hidden=False,
            ),
            _arc(
                "cylinder_base_back",
                radius=cylinder_radius,
                height=0,
                back=True,
                hidden=True,
            ),
            _arc(
                "cylinder_base_front",
                radius=cylinder_radius,
                height=0,
                back=False,
                hidden=False,
            ),
        ],
        "visible_annotations": [],
    }
