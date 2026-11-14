"""Bounded 3D constructions projected into the strict 2D figure recipe.

The cylinder/plane construction is based on the visible edge grammar of
S005-P02-F01 and S078-P19-F01; S058-P19-F01 supplies the parallelogram plane
grammar. The atlas does not contain an identical oblique-cylinder cut.
"""

from __future__ import annotations

import math
from typing import cast

from variant_exam_renderer.figure_recipe import RECIPE_VERSION, FigureRecipeError, Point

_ELEVATION_DEGREES = 25.0
_SIN_ELEVATION = math.sin(math.radians(_ELEVATION_DEGREES))
_COS_ELEVATION = math.cos(math.radians(_ELEVATION_DEGREES))
_ARC_STEPS = 120


def _number(value: object, name: str, minimum: float, maximum: float) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not minimum <= value <= maximum
    ):
        raise FigureRecipeError(
            f"{name} must be a finite number in [{minimum}, {maximum}]"
        )
    return float(value)


def _project(x: float, y: float, z: float) -> Point:
    """Orthographic view from the front, 25 degrees above the base plane."""
    return x, _SIN_ELEVATION * y + _COS_ELEVATION * z


def _arc(
    radius: float,
    z_at_x: float,
    slope: float,
    start: float,
    end: float,
) -> list[list[float]]:
    return [
        list(
            _project(
                radius * math.cos(angle),
                radius * math.sin(angle),
                z_at_x + slope * radius * math.cos(angle),
            )
        )
        for index in range(_ARC_STEPS + 1)
        for angle in (start + (end - start) * index / _ARC_STEPS,)
    ]


def _path(
    identifier: str,
    vertices: list[list[float]],
    *,
    line_style: str = "solid",
    closed: bool = False,
) -> dict[str, object]:
    return {
        "id": identifier,
        "vertices": vertices,
        "closed": closed,
        "fill": False,
        "line_style": line_style,
    }


def build_upright_cylinder_oblique_section(parameters: object) -> dict[str, object]:
    """Project a complete ellipse cut from a vertical right cylinder.

    Required inputs are ``radius`` [0.1,100], ``height`` [0.1,500],
    ``tilt_degrees`` [5,75], and ``section_center_height`` [0,500]. The plane
    is z = section_center_height + tan(tilt_degrees)*x. It must cross only the
    lateral wall: 0 < center +/- radius*tan(tilt) < height. The section's true
    semiaxes are radius/cos(tilt) and radius. Height and section center are
    construction values and are never shown automatically.

    Stable point targets: O (bottom center), R (right base radius endpoint),
    C (section center), T (top center), plane_label_anchor. Stable path targets:
    cutting_plane, top_rim, bottom_front, bottom_back, section_front,
    section_back. Stroke targets: side_left, side_right, radius_OR.
    The back base/section arcs are dashed, while front arcs are solid.
    """
    required = {
        "radius",
        "height",
        "tilt_degrees",
        "section_center_height",
    }
    if not isinstance(parameters, dict):
        msg = "template parameters must be an object"
        raise FigureRecipeError(msg)
    data = cast("dict[object, object]", parameters)
    if set(data) != required:
        raise FigureRecipeError(
            f"upright_cylinder_oblique_section requires exactly {sorted(required)}"
        )
    radius = _number(data["radius"], "radius", 0.1, 100)
    height = _number(data["height"], "height", 0.1, 500)
    tilt = _number(data["tilt_degrees"], "tilt_degrees", 5, 75)
    center_height = _number(
        data["section_center_height"], "section_center_height", 0, 500
    )
    slope = math.tan(math.radians(tilt))
    excursion = radius * slope
    if not 0 < center_height - excursion < center_height + excursion < height:
        msg = "cutting plane must meet only the lateral wall, strictly between the cylinder bases"
        raise FigureRecipeError(msg)

    # A rectangle on the actual cutting plane projects to a genuine
    # parallelogram. It extends beyond the cylinder in both in-plane axes.
    half_width, half_depth = 1.52 * radius, 1.25 * radius
    plane_3d = (
        (-half_width, -half_depth),
        (half_width, -half_depth),
        (half_width, half_depth),
        (-half_width, half_depth),
    )
    plane = [list(_project(x, y, center_height + slope * x)) for x, y in plane_3d]
    points: dict[str, Point] = {
        "O": _project(0, 0, 0),
        "R": _project(radius, 0, 0),
        "C": _project(0, 0, center_height),
        "T": _project(0, 0, height),
        "plane_label_anchor": _project(
            -1.24 * radius, 0, center_height - 1.24 * excursion
        ),
        "left_bottom": _project(-radius, 0, 0),
        "left_top": _project(-radius, 0, height),
        "right_bottom": _project(radius, 0, 0),
        "right_top": _project(radius, 0, height),
    }
    top_rim = _arc(radius, height, 0, 0, 2 * math.pi)
    bottom_back = _arc(radius, 0, 0, 0, math.pi)
    bottom_front = _arc(radius, 0, 0, math.pi, 2 * math.pi)
    section_back = _arc(radius, center_height, slope, 0, math.pi)
    section_front = _arc(radius, center_height, slope, math.pi, 2 * math.pi)
    paths = [
        _path("cutting_plane", plane, closed=True),
        _path("top_rim", top_rim),
        _path("bottom_back", bottom_back, line_style="dashed"),
        _path("bottom_front", bottom_front),
        _path("section_back", section_back, line_style="dashed"),
        _path("section_front", section_front),
    ]
    strokes = [
        {"id": "side_left", "from": "left_bottom", "to": "left_top"},
        {"id": "side_right", "from": "right_bottom", "to": "right_top"},
        {"id": "radius_OR", "from": "O", "to": "R"},
    ]
    coordinates = [
        *points.values(),
        *(
            tuple(vertex)
            for curve in (
                plane,
                top_rim,
                bottom_back,
                bottom_front,
                section_back,
                section_front,
            )
            for vertex in curve
        ),
    ]
    xs, ys = [point[0] for point in coordinates], [point[1] for point in coordinates]
    margin = 0.13 * max(max(xs) - min(xs), max(ys) - min(ys))
    return {
        "schema_version": RECIPE_VERSION,
        "view": [
            min(xs) - margin,
            max(xs) + margin,
            min(ys) - margin,
            max(ys) + margin,
        ],
        "axes": [],
        "equal_aspect": True,
        "points": {name: list(point) for name, point in points.items()},
        "point_markers": {},
        "paths": paths,
        "strokes": strokes,
        "visible_annotations": [],
    }
