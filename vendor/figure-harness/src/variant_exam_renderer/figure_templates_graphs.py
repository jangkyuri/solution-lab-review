"""Bounded graph constructions drawn from the official-exam visual atlas.

These constructors encode mathematical relations, not solutions or visible facts.
Every label must be supplied separately by the caller in visible_annotations.
"""

from __future__ import annotations

import math
from itertools import pairwise
from typing import cast

from variant_exam_renderer.figure_recipe import FigureRecipeError, Point
from variant_exam_renderer.figure_templates_graph_common import (
    flag,
    make_recipe,
    nonzero_strokes,
    number,
    number_list,
    pair,
    parameter_object,
    stroke,
)


def build_polynomial_region(parameters: object) -> dict[str, object]:
    """Build y=a(x-h)^2, its secant, and a separately bounded shaded region."""
    data = parameter_object(
        parameters,
        {
            "quadratic_scale",
            "vertex_x",
            "intersection_x",
            "plot_domain",
            "shade_domain",
            "show_guides",
            "show_chords",
        },
    )
    scale = number(data.get("quadratic_scale", 1), "quadratic_scale", positive=True)
    vertex = number(data.get("vertex_x", 0), "vertex_x")
    left, right = pair(
        data.get("intersection_x", [-1, 2]), "intersection_x", increasing=True
    )
    domain = pair(data.get("plot_domain", [-2.2, 2.5]), "plot_domain", increasing=True)
    shade = pair(
        data.get("shade_domain", [left, right]), "shade_domain", increasing=True
    )
    if not domain[0] < left < vertex < right < domain[1]:
        msg = "require plot_left < left_intersection < vertex_x < right_intersection < plot_right"
        raise FigureRecipeError(msg)
    if not left <= shade[0] < shade[1] <= right:
        msg = "shade_domain must lie between the two intersections"
        raise FigureRecipeError(msg)
    slope = scale * (left + right - 2 * vertex)
    intercept = scale * (vertex * vertex - left * right)
    points = {
        "O": (0.0, 0.0),
        "V": (vertex, 0.0),
        "A": (right, scale * (right - vertex) ** 2),
        "B": (left, scale * (left - vertex) ** 2),
        "C": (right, 0.0),
        "D": (left, 0.0),
    }
    extents = [
        (x, y)
        for x in domain
        for y in (scale * (x - vertex) ** 2, slope * x + intercept)
    ]
    extents.append(points["V"])
    recipe = make_recipe(points, extents)
    recipe["curves"] = [
        {
            "id": "parabola",
            "coefficients": [scale * vertex * vertex, -2 * scale * vertex, scale],
            "plot_domain": list(domain),
            "fill_domain": list(shade),
        },
        {
            "id": "secant",
            "coefficients": [intercept, slope],
            "plot_domain": list(domain),
        },
    ]
    strokes: list[dict[str, object]] = []
    if flag(data, "show_guides", default=True):
        strokes.extend([stroke("guide_A", "A", "C"), stroke("guide_B", "B", "D")])
    if flag(data, "show_chords", default=True):
        strokes.extend([stroke("chord_A", "A", "V"), stroke("chord_B", "B", "V")])
    recipe["strokes"] = strokes
    return recipe


def build_quadratic_line_enclosed_region(parameters: object) -> dict[str, object]:
    """Draw a quadratic and line meeting at two exact x values, with optional fill."""
    data = parameter_object(
        parameters,
        {
            "intersection_x",
            "quadratic_scale",
            "line_slope",
            "line_intercept",
            "plot_domain",
            "shade_region",
        },
    )
    left, right = pair(
        data.get("intersection_x", [-1, 2]), "intersection_x", increasing=True
    )
    scale = number(data.get("quadratic_scale", 1), "quadratic_scale")
    if abs(scale) < 0.01:
        msg = "quadratic_scale must have magnitude at least 0.01"
        raise FigureRecipeError(msg)
    slope = number(data.get("line_slope", 1), "line_slope")
    intercept = number(data.get("line_intercept", 1), "line_intercept")
    domain = pair(
        data.get("plot_domain", [-1.75, 2.75]), "plot_domain", increasing=True
    )
    if not domain[0] < left < right < domain[1]:
        msg = "require plot_left < left_intersection < right_intersection < plot_right"
        raise FigureRecipeError(msg)

    def line(x: float) -> float:
        return slope * x + intercept

    def quadratic(x: float) -> float:
        return line(x) + scale * (x - left) * (x - right)

    vertex_x = (left + right - slope / scale) / 2
    points: dict[str, Point] = {
        "O": (0.0, 0.0),
        "I_left": (left, line(left)),
        "I_right": (right, line(right)),
    }
    extents = [
        (x, y)
        for x in domain
        for y in (quadratic(x), line(x))
    ]
    if domain[0] <= vertex_x <= domain[1]:
        points["V"] = (vertex_x, quadratic(vertex_x))
        extents.append(points["V"])
    recipe = make_recipe(points, extents)
    recipe["curves"] = [
        {
            "id": "quadratic",
            "coefficients": [
                intercept + scale * left * right,
                slope - scale * (left + right),
                scale,
            ],
            "plot_domain": list(domain),
        },
        {
            "id": "line",
            "coefficients": [intercept, slope],
            "plot_domain": list(domain),
        },
    ]
    if flag(data, "shade_region", default=False):
        sample_x = [left + (right - left) * i / 160 for i in range(161)]
        vertices = [
            *([x, quadratic(x)] for x in sample_x),
            *([x, line(x)] for x in reversed(sample_x)),
        ]
        recipe["paths"] = [
            {
                "id": "enclosed_region",
                "vertices": vertices,
                "closed": True,
                "fill": True,
                "stroke": False,
            }
        ]
    return recipe


def build_piecewise_endpoints(parameters: object) -> dict[str, object]:
    """Build three disjoint branches with explicit one-sided boundary markers."""
    data = parameter_object(
        parameters,
        {
            "breaks",
            "left_slope",
            "left_value",
            "middle_value",
            "right_value",
            "right_scale",
            "isolated_value",
            "plot_domain",
            "show_guides",
        },
    )
    left, right = pair(data.get("breaks", [-1, 1]), "breaks", increasing=True)
    domain = pair(data.get("plot_domain", [-2.75, 2.3]), "plot_domain", increasing=True)
    if not domain[0] < left < right < domain[1]:
        msg = "breaks must lie strictly within plot_domain"
        raise FigureRecipeError(msg)
    slope = number(data.get("left_slope", 1), "left_slope")
    y_left = number(data.get("left_value", 1), "left_value")
    y_middle = number(data.get("middle_value", -1), "middle_value")
    y_right = number(data.get("right_value", 2), "right_value")
    scale = number(data.get("right_scale", 1), "right_scale", positive=True)
    isolated_value = data.get("isolated_value", 1)
    isolated = (
        None if isolated_value is None else number(isolated_value, "isolated_value")
    )
    # The two right-hand branch endpoints are both open. Equal limits may
    # therefore share a location; only an open/filled collision is invalid.
    if y_middle == y_left or isolated in (y_middle, y_right):
        msg = "boundary values must not create coincident open and filled markers"
        raise FigureRecipeError(msg)
    points: dict[str, Point] = {
        "O": (0.0, 0.0),
        "L_open": (left, y_left),
        "L_closed": (left, y_middle),
        "R_open": (right, y_right),
        "R_middle_open": (right, y_middle),
        "L_foot": (left, 0.0),
        "R_foot": (right, 0.0),
        "L_level": (0.0, y_left),
        "R_level": (0.0, y_right),
    }
    markers = {
        "L_open": "open",
        "L_closed": "filled",
        "R_open": "open",
        # Retain the second endpoint anchor, but draw their shared open marker
        # once so the ordinary marker separation checks remain meaningful.
        "R_middle_open": "none" if y_middle == y_right else "open",
    }
    if isolated is not None:
        points["R_value"] = (right, isolated)
        markers["R_value"] = "filled"
    extents = [
        (domain[0], y_left + slope * (domain[0] - left)),
        (domain[1], y_right + scale * (domain[1] - right) ** 2),
        points["L_open"],
        points["L_closed"],
        points["R_open"],
        points["R_middle_open"],
    ]
    recipe = make_recipe(points, extents, markers=markers)
    recipe["curves"] = [
        {
            "id": "left_branch",
            "coefficients": [y_left - slope * left, slope],
            "plot_domain": [domain[0], left],
        },
        {
            "id": "middle_branch",
            "coefficients": [y_middle],
            "plot_domain": [left, right],
        },
        {
            "id": "right_branch",
            "coefficients": [
                y_right + scale * right * right,
                -2 * scale * right,
                scale,
            ],
            "plot_domain": [right, domain[1]],
        },
    ]
    strokes: list[dict[str, object]] = []
    if flag(data, "show_guides", default=True):
        strokes.extend(
            [
                stroke("guide_L_vertical", "L_open", "L_foot", dashed=True),
                stroke("guide_R_vertical", "R_open", "R_foot", dashed=True),
                stroke("guide_L_level", "L_open", "L_level", dashed=True),
                stroke("guide_R_level", "R_open", "R_level", dashed=True),
            ]
        )
        if isolated == y_left:
            strokes.append(stroke("guide_value", "L_level", "R_value", dashed=True))
    recipe["strokes"] = nonzero_strokes(strokes, points)
    return recipe


def build_trig_guides(parameters: object) -> dict[str, object]:
    """Build one sine graph and only the requested coordinate/extremum guides."""
    data = parameter_object(
        parameters,
        {
            "amplitude",
            "frequency",
            "phase",
            "offset",
            "plot_domain",
            "guide_x",
            "show_extrema",
        },
    )
    amplitude = number(data.get("amplitude", 2), "amplitude", positive=True)
    frequency = number(data.get("frequency", 2), "frequency", positive=True)
    phase = number(data.get("phase", 0), "phase")
    offset = number(data.get("offset", 1), "offset")
    domain = pair(data.get("plot_domain", [-2.8, 5.9]), "plot_domain", increasing=True)
    if frequency * (domain[1] - domain[0]) > 12 * math.pi:
        msg = "trig plot_domain may contain at most six periods"
        raise FigureRecipeError(msg)
    guides = number_list(
        data.get("guide_x", [math.pi / 4, 5 * math.pi / 4]), "guide_x", 0, 12
    )
    if len(set(guides)) != len(guides) or any(
        not domain[0] <= x <= domain[1] for x in guides
    ):
        msg = "guide_x coordinates must be distinct and within plot_domain"
        raise FigureRecipeError(msg)
    upper, lower = offset + amplitude, offset - amplitude
    points: dict[str, Point] = {
        "O": (0.0, 0.0),
        "upper_level": (0.0, upper),
        "lower_level": (0.0, lower),
    }
    strokes: list[dict[str, object]] = []
    if flag(data, "show_extrema", default=True):
        for name, y in (("upper", upper), ("lower", lower)):
            points[f"{name}_start"], points[f"{name}_end"] = (
                (domain[0], y),
                (domain[1], y),
            )
            strokes.append(
                stroke(f"extrema_{name}", f"{name}_start", f"{name}_end", dashed=True)
            )
    for index, x in enumerate(guides):
        points[f"G{index}"] = (x, amplitude * math.sin(frequency * x + phase) + offset)
        points[f"G{index}_foot"] = (x, 0.0)
        strokes.append(
            stroke(f"guide_{index}", f"G{index}", f"G{index}_foot", dashed=True)
        )
    values = [amplitude * math.sin(frequency * x + phase) + offset for x in domain]
    first_extremum = math.ceil((frequency * domain[0] + phase - math.pi / 2) / math.pi)
    last_extremum = math.floor((frequency * domain[1] + phase - math.pi / 2) / math.pi)
    values.extend(
        offset + amplitude * (1 if index % 2 == 0 else -1)
        for index in range(first_extremum, last_extremum + 1)
    )
    recipe = make_recipe(points, [(domain[0], min(values)), (domain[1], max(values))])
    recipe["curves"] = [
        {
            "id": "wave",
            "expression": f"{amplitude!r}*sin({frequency!r}*x+({phase!r}))+({offset!r})",
            "plot_domain": list(domain),
        }
    ]
    recipe["strokes"] = nonzero_strokes(strokes, points)
    return recipe


def build_piecewise_density(parameters: object) -> dict[str, object]:
    """Build a nonnegative piecewise-linear density whose supplied area is one."""
    data = parameter_object(
        parameters, {"knots", "heights", "guide_indices", "show_height_guide"}
    )
    knots = number_list(data.get("knots", [0, 1, 2, 3, 4]), "knots", 3, 25)
    heights = number_list(data.get("heights", [0, 0.5, 0, 0.5, 0]), "heights", 3, 25)
    if len(knots) != len(heights) or any(
        right - left < 0.01 for left, right in pairwise(knots)
    ):
        msg = "knots and heights need equal lengths and strictly increasing knots separated by at least 0.01"
        raise FigureRecipeError(msg)
    if min(heights) < 0 or heights[0] != 0 or heights[-1] != 0:
        msg = "density heights must be nonnegative and vanish at both support endpoints"
        raise FigureRecipeError(msg)
    area = math.fsum(
        (knots[i + 1] - knots[i]) * (heights[i] + heights[i + 1]) / 2
        for i in range(len(knots) - 1)
    )
    if not math.isclose(area, 1.0, rel_tol=1e-9, abs_tol=1e-9):
        raise FigureRecipeError(
            f"density trapezoid area must equal one; supplied area is {area:g}"
        )
    indices_value = data.get(
        "guide_indices", [i for i, y in enumerate(heights) if y > 0]
    )
    if not isinstance(indices_value, list):
        msg = "guide_indices must be an array"
        raise FigureRecipeError(msg)
    raw_indices = cast("list[object]", indices_value)
    if len(raw_indices) > 25 or any(
        isinstance(i, bool) or not isinstance(i, int) or not 0 <= i < len(knots)
        for i in raw_indices
    ):
        msg = "guide_indices must contain at most 25 valid integer knot indices"
        raise FigureRecipeError(msg)
    indices = cast("list[int]", raw_indices)
    if len(indices) != len(set(indices)):
        msg = "guide_indices must not repeat"
        raise FigureRecipeError(msg)
    points: dict[str, Point] = {"O": (0.0, 0.0), "peak_level": (0.0, max(heights))}
    vertices = list(zip(knots, heights, strict=True))
    for i, point in enumerate(vertices):
        points[f"K{i}"], points[f"F{i}"] = point, (point[0], 0.0)
    strokes = [stroke(f"guide_{i}", f"K{i}", f"F{i}", dashed=True) for i in indices]
    if flag(data, "show_height_guide", default=True):
        points["height_start"], points["height_end"] = (
            (min(0.0, knots[0]), max(heights)),
            (max(0.0, knots[-1]), max(heights)),
        )
        strokes.append(
            stroke("height_guide", "height_start", "height_end", dashed=True)
        )
    recipe = make_recipe(points, vertices)
    recipe["paths"] = [
        {
            "id": "density",
            "vertices": [list(point) for point in vertices],
            "closed": False,
            "fill": False,
        }
    ]
    recipe["strokes"] = nonzero_strokes(strokes, points)
    return recipe


def build_hyperbola_foci(parameters: object) -> dict[str, object]:
    """Build separate horizontal hyperbola branches with exact focal geometry."""
    data = parameter_object(
        parameters,
        {
            "center",
            "a",
            "b",
            "parameter_max",
            "point_parameter",
            "focus_markers",
            "show_focal_segments",
            "show_asymptotes",
        },
    )
    h, k = pair(data.get("center", [0, 0]), "center")
    a = number(data.get("a", 3), "a", positive=True)
    b = number(data.get("b", 4), "b", positive=True)
    maximum = number(data.get("parameter_max", 1.25), "parameter_max", positive=True)
    parameter = number(data.get("point_parameter", 0.7), "point_parameter")
    if maximum > 2 or abs(parameter) >= maximum:
        msg = "require abs(point_parameter) < parameter_max <= 2"
        raise FigureRecipeError(msg)
    marker = data.get("focus_markers", "none")
    if not isinstance(marker, str) or marker not in {"none", "open", "filled"}:
        msg = "focus_markers must be none, open, or filled"
        raise FigureRecipeError(msg)
    c = math.hypot(a, b)
    points: dict[str, Point] = {
        "O": (h, k),
        "F": (h + c, k),
        "Fprime": (h - c, k),
        "V_right": (h + a, k),
        "V_left": (h - a, k),
        "A": (h + a * math.cosh(parameter), k + b * math.sinh(parameter)),
    }
    paths: list[dict[str, object]] = []
    extents: list[Point] = []
    for name, sign in (("right_branch", 1), ("left_branch", -1)):
        vertices = [
            (h + sign * a * math.cosh(t), k + b * math.sinh(t))
            for t in (-maximum + 2 * maximum * i / 240 for i in range(241))
        ]
        extents.extend(vertices)
        paths.append(
            {
                "id": name,
                "vertices": [list(point) for point in vertices],
                "fill": False,
                "closed": False,
            }
        )
    strokes: list[dict[str, object]] = []
    if flag(data, "show_focal_segments", default=True):
        strokes.extend(
            [stroke("focal_right", "A", "F"), stroke("focal_left", "A", "Fprime")]
        )
    if flag(data, "show_asymptotes", default=False):
        width = a * math.cosh(maximum)
        for name, sign in (("up", 1), ("down", -1)):
            points[f"asymptote_{name}_start"] = (h - width, k - sign * b * width / a)
            points[f"asymptote_{name}_end"] = (h + width, k + sign * b * width / a)
            strokes.append(
                stroke(
                    f"asymptote_{name}",
                    f"asymptote_{name}_start",
                    f"asymptote_{name}_end",
                    dashed=True,
                )
            )
    recipe = make_recipe(
        points, extents, equal_aspect=True, markers={"F": marker, "Fprime": marker}
    )
    recipe["paths"], recipe["strokes"] = paths, strokes
    return recipe
