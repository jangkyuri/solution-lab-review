"""Strict recipe shape validation, independent of drawing and mathematical QA."""

from __future__ import annotations

import math
import re
from typing import cast

from variant_exam_renderer.figure_recipe import (
    RECIPE_VERSION,
    AngleSweep,
    ArrowStyle,
    FigureRecipe,
    FigureRecipeError,
    LabelPlacement,
    LineStyle,
    Pair,
    Point,
    PointMarkerStyle,
    RecipeAngle,
    RecipeCurve,
    RecipeEllipse,
    RecipeEllipseArc,
    RecipeLabel,
    RecipePath,
    RecipeStroke,
    RecipeTickMark,
)
from variant_exam_renderer.figure_recipe_math import parse_expression


def _object(value: object, allowed: set[str]) -> dict[str, object]:
    if not isinstance(value, dict):
        msg = "recipe member must be an object"
        raise FigureRecipeError(msg)
    data = cast("dict[str, object]", value)
    if data.keys() - allowed:
        raise FigureRecipeError(
            f"unknown recipe fields: {sorted(data.keys() - allowed)}"
        )
    return data


def _array(value: object, maximum: int = 200) -> list[object]:
    if not isinstance(value, list) or len(cast("list[object]", value)) > maximum:
        raise FigureRecipeError(
            f"recipe member must be an array of at most {maximum} items"
        )
    return cast("list[object]", value)


def _text(value: object) -> str:
    if (
        not isinstance(value, str)
        or not value.strip()
        or len(value) > 300
        or any(ord(ch) < 32 for ch in value)
    ):
        msg = "recipe text must be nonempty, single-line, and at most 300 characters"
        raise FigureRecipeError(msg)
    return value


def _number(value: object) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or abs(value) > 1e6
        or not math.isfinite(value)
    ):
        msg = "recipe number must be finite and at most 1000000 in magnitude"
        raise FigureRecipeError(msg)
    return float(value)


def _point(value: object) -> Point:
    values = _array(value, 2)
    if len(values) != 2:
        msg = "expected two coordinates"
        raise FigureRecipeError(msg)
    return _number(values[0]), _number(values[1])


def _flag(data: dict[str, object], key: str, default: bool = False) -> bool:
    value = data.get(key, default)
    if not isinstance(value, bool):
        raise FigureRecipeError(f"{key} must be a boolean")
    return value


def _line_style(data: dict[str, object], *, required: bool = False) -> LineStyle:
    value = _text(data["line_style"] if required else data.get("line_style", "solid"))
    if value not in {"solid", "dashed", "dotted"}:
        msg = "line_style must be solid, dashed, or dotted"
        raise FigureRecipeError(msg)
    return cast("LineStyle", value)


def _label_placement(data: dict[str, object]) -> LabelPlacement:
    value = data.get("label_placement", "legacy")
    if value not in ("legacy", "anchored"):
        msg = "label_placement must be legacy or anchored"
        raise FigureRecipeError(msg)
    return value


def _curve(value: object) -> RecipeCurve:
    data = _object(
        value,
        {
            "id",
            "coefficients",
            "expression",
            "plot_domain",
            "fill_domain",
            "line_style",
        },
    )
    coefficients = tuple(
        _number(item) for item in _array(data.get("coefficients", []), 13)
    )
    expression = _text(data["expression"]) if "expression" in data else None
    if bool(coefficients) == (expression is not None):
        msg = "curve requires exactly one of coefficients or expression"
        raise FigureRecipeError(msg)
    if expression is not None:
        _ = parse_expression(expression)
    domain = _point(data["plot_domain"])
    fill = _point(data["fill_domain"]) if data.get("fill_domain") is not None else None
    if domain[0] >= domain[1] or (
        fill is not None and not domain[0] <= fill[0] < fill[1] <= domain[1]
    ):
        msg = "fill domain must lie within increasing plot domain"
        raise FigureRecipeError(msg)
    return RecipeCurve(
        _text(data["id"]), coefficients, expression, domain, fill, _line_style(data)
    )


def _angle(value: object, *, right: bool = False) -> RecipeAngle:
    allowed = {"id", "vertex", "ray1", "ray2"}
    if not right:
        allowed.add("sweep")
    data = _object(value, allowed)
    sweep = _text(data.get("sweep", "minor"))
    if sweep not in {"minor", "ccw", "cw"}:
        msg = "angle sweep must be minor, ccw, or cw"
        raise FigureRecipeError(msg)
    return RecipeAngle(
        "" if right else _text(data["id"]),
        _text(data["vertex"]),
        _text(data["ray1"]),
        _text(data["ray2"]),
        cast("AngleSweep", sweep),
    )


def _pairs(value: object) -> tuple[Pair, ...]:
    result: list[Pair] = []
    for item in _array(value):
        pair = _array(item, 2)
        if len(pair) != 2:
            msg = "segment needs two point names"
            raise FigureRecipeError(msg)
        result.append((_text(pair[0]), _text(pair[1])))
    return tuple(result)


def _label(value: object) -> RecipeLabel:
    data = _object(value, {"id", "text", "target", "preferred_direction"})
    direction = _text(data.get("preferred_direction", "NE"))
    if direction not in {"N", "NE", "E", "SE", "S", "SW", "W", "NW"}:
        msg = "invalid label direction"
        raise FigureRecipeError(msg)
    return RecipeLabel(
        _text(data["id"]), _text(data["text"]), _text(data["target"]), direction
    )


def _path(value: object) -> RecipePath:
    data = _object(
        value, {"id", "vertices", "fill", "closed", "line_style", "arrow", "stroke"}
    )
    vertices = tuple(_point(item) for item in _array(data["vertices"], 2048))
    fill, closed = _flag(data, "fill"), _flag(data, "closed")
    stroke = _flag(data, "stroke", default=True)
    if len(vertices) < (3 if closed or fill else 2) or (fill and not closed):
        msg = "filled paths must be closed polygons with at least three vertices"
        raise FigureRecipeError(msg)
    if not stroke and not (fill and closed):
        msg = "stroke:false requires a filled closed path"
        raise FigureRecipeError(msg)
    arrow = _text(data.get("arrow", "none"))
    if arrow not in {"none", "end", "both"}:
        msg = "path arrow must be none, end, or both"
        raise FigureRecipeError(msg)
    if arrow != "none":
        if fill:
            msg = "filled paths cannot have arrows"
            raise FigureRecipeError(msg)
        if closed:
            if arrow == "both":
                msg = "closed paths support only an end arrow at the first vertex"
                raise FigureRecipeError(msg)
            if vertices[0] == vertices[-1]:
                msg = "arrowed closed paths must omit a repeated closing vertex"
                raise FigureRecipeError(msg)
        if (not closed and vertices[-2] == vertices[-1]) or (
            arrow == "both" and vertices[0] == vertices[1]
        ):
            msg = "path arrow needs a nonzero endpoint tangent"
            raise FigureRecipeError(msg)
    return RecipePath(
        _text(data["id"]),
        vertices,
        fill,
        closed,
        _line_style(data),
        cast("ArrowStyle", arrow),
        stroke,
    )


def _ellipse(value: object) -> RecipeEllipse:
    data = _object(
        value, {"id", "center", "radii", "rotation_degrees", "fill", "line_style"}
    )
    radii = _point(data["radii"])
    if min(radii) <= 0:
        msg = "ellipse radii must be positive"
        raise FigureRecipeError(msg)
    return RecipeEllipse(
        _text(data["id"]),
        _point(data["center"]),
        radii,
        _number(data.get("rotation_degrees", 0)),
        _flag(data, "fill"),
        _line_style(data),
    )


def _ellipse_arc(value: object) -> RecipeEllipseArc:
    data = _object(
        value,
        {
            "id",
            "center",
            "radii",
            "rotation_degrees",
            "start_degrees",
            "end_degrees",
            "line_style",
        },
    )
    radii = _point(data["radii"])
    if min(radii) <= 0:
        msg = "ellipse arc radii must be positive"
        raise FigureRecipeError(msg)
    start = _number(data["start_degrees"])
    end = _number(data["end_degrees"])
    if end <= start or end - start > 360:
        msg = "ellipse arc degrees must increase with a sweep of at most 360"
        raise FigureRecipeError(msg)
    return RecipeEllipseArc(
        _text(data["id"]),
        _point(data["center"]),
        radii,
        _number(data["rotation_degrees"]),
        start,
        end,
        _line_style(data, required=True),
    )


def _stroke(value: object) -> RecipeStroke:
    data = _object(value, {"id", "from", "to", "line_style", "arrow"})
    arrow = _text(data.get("arrow", "none"))
    if arrow not in {"none", "end", "both"}:
        msg = "arrow must be none, end, or both"
        raise FigureRecipeError(msg)
    return RecipeStroke(
        _text(data["id"]),
        _text(data["from"]),
        _text(data["to"]),
        _line_style(data),
        cast("ArrowStyle", arrow),
    )


def _tick_mark(value: object) -> RecipeTickMark:
    data = _object(value, {"from", "to", "count"})
    count = data["count"]
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 3:
        msg = "tick mark count must be an integer from 1 to 3"
        raise FigureRecipeError(msg)
    return RecipeTickMark(_text(data["from"]), _text(data["to"]), count)


def _point_markers(value: object) -> tuple[tuple[str, PointMarkerStyle], ...]:
    if not isinstance(value, dict) or len(cast("dict[str, object]", value)) > 200:
        msg = "point_markers must be an object of at most 200 point names"
        raise FigureRecipeError(msg)
    result: list[tuple[str, PointMarkerStyle]] = []
    for name, marker in cast("dict[str, object]", value).items():
        style = _text(marker)
        if style not in {"none", "open", "filled"}:
            msg = "point marker must be none, open, or filled"
            raise FigureRecipeError(msg)
        result.append((_text(name), cast("PointMarkerStyle", style)))
    return tuple(result)


def _expand_template(data: dict[str, object]) -> dict[str, object]:
    envelope = _object(data, {"schema_version", "template", "visible_annotations"})
    template = _object(envelope["template"], {"id", "parameters"})
    _ = _text(template["id"])
    _ = tuple(_label(item) for item in _array(envelope["visible_annotations"], 80))
    if not isinstance(template["parameters"], dict):
        msg = "template parameters must be an object"
        raise FigureRecipeError(msg)
    # Lazy import keeps primitive parsing independent of template construction.
    from variant_exam_renderer.figure_templates import (  # noqa: PLC0415
        expand_figure_template,
    )

    expanded = expand_figure_template(envelope)
    if "template" in expanded:
        msg = "expanded recipe must not contain a template"
        raise FigureRecipeError(msg)
    return expanded


def parse_figure_recipe(value: object) -> FigureRecipe:
    """Parse a recognized version; reject unknown fields rather than ignore them."""
    try:
        data = _object(
            value,
            {
                "schema_version",
                "view",
                "axes",
                "points",
                "curves",
                "segments",
                "equal_marks",
                "right_angles",
                "angle_marks",
                "visible_annotations",
                "paths",
                "ellipses",
                "ellipse_arcs",
                "equal_aspect",
                "strokes",
                "point_markers",
                "tick_marks",
                "template",
                "label_placement",
            },
        )
        if data["schema_version"] != RECIPE_VERSION:
            msg = "unsupported figure recipe version"
            raise FigureRecipeError(msg)
        if "template" in data:
            return parse_figure_recipe(_expand_template(data))
        view = tuple(_number(item) for item in _array(data["view"], 4))
        if len(view) != 4 or view[0] >= view[1] or view[2] >= view[3]:
            msg = "view must be [xmin,xmax,ymin,ymax] with increasing ranges"
            raise FigureRecipeError(msg)
        raw_points = data.get("points", {})
        if (
            not isinstance(raw_points, dict)
            or len(cast("dict[str, object]", raw_points)) > 200
        ):
            msg = "points must be an object of at most 200 points"
            raise FigureRecipeError(msg)
        points = tuple(
            (_text(name), _point(point))
            for name, point in cast("dict[str, object]", raw_points).items()
        )
        axes = tuple(_text(item) for item in _array(data.get("axes", []), 2))
        if set(axes) - {"x", "y"} or len(set(axes)) != len(axes):
            msg = "axes may contain x and y once each"
            raise FigureRecipeError(msg)
        recipe = FigureRecipe(
            (view[0], view[1], view[2], view[3]),
            axes,
            points,
            tuple(_curve(item) for item in _array(data.get("curves", []), 32)),
            _pairs(data.get("segments", [])),
            _pairs(data.get("equal_marks", [])),
            tuple(
                _angle(item, right=True)
                for item in _array(data.get("right_angles", []), 32)
            ),
            tuple(_angle(item) for item in _array(data.get("angle_marks", []), 32)),
            tuple(_label(item) for item in _array(data["visible_annotations"], 80)),
            tuple(_path(item) for item in _array(data.get("paths", []), 32)),
            tuple(_ellipse(item) for item in _array(data.get("ellipses", []), 32)),
            _flag(data, "equal_aspect", not axes),
            tuple(_stroke(item) for item in _array(data.get("strokes", []))),
            _point_markers(data["point_markers"]) if "point_markers" in data else None,
            tuple(_tick_mark(item) for item in _array(data.get("tick_marks", []))),
            _label_placement(data),
            tuple(
                _ellipse_arc(item) for item in _array(data.get("ellipse_arcs", []), 64)
            ),
        )
        _validate_references(recipe)
    except (KeyError, TypeError) as exc:
        raise FigureRecipeError(f"missing or invalid recipe member: {exc}") from exc
    return recipe


def _validate_references(recipe: FigureRecipe) -> None:
    points = dict(recipe.points)
    names = [
        *points,
        *(curve.id for curve in recipe.curves),
        *(angle.id for angle in recipe.angle_marks),
        *(path.id for path in recipe.paths),
        *(ellipse.id for ellipse in recipe.ellipses),
        *(arc.id for arc in recipe.ellipse_arcs),
        *(stroke.id for stroke in recipe.strokes),
        *("axis_" + axis for axis in recipe.axes),
    ]
    if len(names) != len(set(names)):
        msg = "duplicate recipe target id"
        raise FigureRecipeError(msg)
    ids = [label.id for label in recipe.visible_annotations]
    if len(ids) != len(set(ids)):
        msg = "duplicate label id"
        raise FigureRecipeError(msg)
    curve_ids = {curve.id for curve in recipe.curves}
    for index, label in enumerate(recipe.visible_annotations):
        if label.target not in names:
            raise FigureRecipeError(
                f"visible_annotations[{index}].target ({label.id}): unknown label target {label.target}"
            )
        if label.target in curve_ids and not _is_drawable_math_label(label.text):
            raise FigureRecipeError(
                f"visible_annotations[{index}].text ({label.id}): curve label must be non-empty, parseable math text"
            )
    for name, _ in recipe.point_markers or ():
        if name not in points:
            raise FigureRecipeError(f"unknown point marker target {name}")
    endpoint_pairs = (
        *recipe.segments,
        *recipe.equal_marks,
        *((stroke.start, stroke.end) for stroke in recipe.strokes),
        *((mark.start, mark.end) for mark in recipe.tick_marks),
    )
    for start, end in endpoint_pairs:
        if start not in points or end not in points or points[start] == points[end]:
            msg = "missing or coincident segment endpoint"
            raise FigureRecipeError(msg)
    for angle in (*recipe.right_angles, *recipe.angle_marks):
        for ray in (angle.ray1, angle.ray2):
            if (
                angle.vertex not in points
                or ray not in points
                or points[ray] == points[angle.vertex]
            ):
                msg = "invalid angle reference"
                raise FigureRecipeError(msg)


def _is_drawable_math_label(text: str) -> bool:
    # T4 (variant line, lead 2026-11-12): a curve label is display text drawn verbatim at its anchor
    # (recipe_drawing); only an empty label or math the drawing cannot parse is refused.
    body = text.strip()
    if not body.strip("$").strip():
        return False
    if "$" not in body and HANGUL_LABEL.search(body) is not None:
        return True
    from matplotlib.mathtext import MathTextParser

    try:
        MathTextParser("path").parse(body if "$" in body else f"${body}$")
    except ValueError:
        return False
    return True


HANGUL_LABEL = re.compile("[\uac00-\ud7a3]")


def _is_curve_name(text: str) -> bool:
    # Names never become equations derived from hidden construction coefficients.
    return (
        re.fullmatch(
            r"(?:[A-Za-z]|\\ell)(?:'|\u2032|\\prime|\^\{\\prime\}|\^\\prime)*(?:_(?:[A-Za-z0-9]|\{[A-Za-z0-9]+\}))?",
            text,
        )
        is not None
    )


def _is_coordinate_equation(text: str) -> bool:
    parts = text.split("=")
    if len(parts) == 3 and parts[0] == "y" and re.fullmatch(
        r"[A-Za-z](?:'|\\prime)*\((?:x|t)\)", parts[1]
    ):
        # A displayed function identity may name the same curve and give its equation.
        parts = [parts[0], parts[2]]
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return False
    # Ignore TeX command names so the coordinate must appear in the equation.
    without_commands = re.sub(r"\\[A-Za-z]+", "", text)
    return "x" in without_commands or "y" in without_commands
