"""Fixed local drawing engine: recipe data in, PNG bytes out, no model calls."""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from dataclasses import dataclass
from dataclasses import replace as dataclass_replace
from io import BytesIO
from itertools import pairwise
from typing import TYPE_CHECKING, Final, cast

from matplotlib import (
    rc_context,  # pyright: ignore[reportUnknownVariableType]  # Matplotlib's PathLike parameter lacks its type argument.
)
from matplotlib.axes import Axes
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure
from matplotlib.patches import Ellipse, Polygon
from matplotlib.transforms import Bbox, IdentityTransform
from matplotlib.typing import RcKeyType
from PIL import Image, ImageChops, ImageFilter, ImageOps

from variant_exam_renderer.figure_recipe import (
    ArrowStyle,
    FigureRecipe,
    FigureRecipeError,
    LineStyle,
    Point,
    RecipeAngle,
    RecipeEllipseArc,
    RecipeLabel,
    RecipePath,
)
from variant_exam_renderer.figure_recipe_math import curve_function
from variant_exam_renderer.render.figure_math_fonts import (
    figure_math_rc,
    normalize_figure_fractions,
    normalize_figure_math_aliases,
)
from variant_exam_renderer.render.figure_math_layout import FigureMathTextParser
from variant_exam_renderer.render.figure_style import (
    ARROW_HALF_WIDTH_RATIO,
    ARROW_HEAD_PT,
    ARROW_NOTCH_FRACTION,
    AUX_LINE_PT,
    AXIS_LINE_PT,
    CURVE_LINE_PT,
    FILL_COLOR,
    INK_COLOR,
    LABEL_FONT_PT,
    MAIN_LINE_PT,
)

if TYPE_CHECKING:
    from matplotlib.text import Text

DPI: Final = 400
PT: Final = DPI / 72
PAD: Final = round(1.2 * DPI / 25.4)
ANGLE_RADIUS_PT: Final = 14.4
ANGLE_RAY_FRACTION: Final = 0.18
ANGLE_ARC_GAP_PT: Final = 3.0
ANGLE_LABEL_MAX_GAP_PT: Final = 12.0
ANGLE_RAY_CLEARANCE_PT: Final = 0.6
POINT_OWNER_MARGIN_PT: Final = 1.0
DIRECTIONS: Final[dict[str, Point]] = {
    "N": (0, 1),
    "NE": (1, 1),
    "E": (1, 0),
    "SE": (1, -1),
    "S": (0, -1),
    "SW": (-1, -1),
    "W": (-1, 0),
    "NW": (-1, 1),
}
# Physical dash lengths remain legible after the figure is placed in a column.
LINE_STYLES: Final[dict[LineStyle, str | tuple[int, tuple[float, ...]]]] = {
    "solid": "-",
    "dashed": (0, (1.4, 1.4)),
    "dotted": (0, (0.8, 2.0)),
}
HANGUL: Final = re.compile(r"[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]")
MATH_TEXT_SINGLE_DIGIT_ROOT: Final = re.compile(r"\\sqrt[ \t]*([0-9])")
SIMPLE_POINT_NAME: Final = re.compile(
    r"^\$([A-Z])(_(?:[A-Za-z0-9]|\{[A-Za-z0-9]+\}))?\$"
)
AXIS_COORDINATE_SIDE_ERROR: Final = (
    "axis coordinate label cannot stay near preferred side"
)
AXIS_COORDINATE_MAX_GAP_PT: Final = 7.3


@dataclass(frozen=True, slots=True)
class RecipeDrawing:
    png: bytes
    labels: tuple[str, ...]
    label_boxes: tuple[tuple[float, float, float, float], ...]
    point_positions: tuple[tuple[str, Point], ...] = ()


@dataclass(frozen=True, slots=True)
class _AngleGeometry:
    vertex: Point
    start: float
    sweep: float
    radius_px: float


def _angle_geometry(
    ax: Axes, mark: RecipeAngle, points: dict[str, Point]
) -> _AngleGeometry:
    vertex = _display(ax, points[mark.vertex])
    first, last = _display(ax, points[mark.ray1]), _display(ax, points[mark.ray2])
    first_vector = (first[0] - vertex[0], first[1] - vertex[1])
    last_vector = (last[0] - vertex[0], last[1] - vertex[1])
    start = math.atan2(first_vector[1], first_vector[0])
    finish = math.atan2(last_vector[1], last_vector[0])
    if mark.sweep == "ccw":
        sweep = (finish - start) % (2 * math.pi)
    elif mark.sweep == "cw":
        sweep = -((start - finish) % (2 * math.pi))
    else:
        sweep = (finish - start + math.pi) % (2 * math.pi) - math.pi
    if abs(sweep) < 1e-8:
        raise FigureRecipeError(f"angle rays have the same direction: {mark.id}")
    radius_px = min(
        ANGLE_RADIUS_PT * PT,
        ANGLE_RAY_FRACTION * min(math.hypot(*first_vector), math.hypot(*last_vector)),
    )
    return _AngleGeometry(vertex, start, sweep, radius_px)


def _display(ax: Axes, point: Point) -> Point:
    return cast("Point", ax.transData.transform(point).tolist())


def _data(ax: Axes, point: Point) -> Point:
    return cast("Point", ax.transData.inverted().transform(point).tolist())


def _unit(point: Point) -> Point:
    length = math.hypot(*point)
    if length == 0:
        msg = "coincident geometry points"
        raise FigureRecipeError(msg)
    return point[0] / length, point[1] / length


def _stroke(
    ax: Axes,
    vertices: tuple[Point, ...],
    width: float = MAIN_LINE_PT,
    line_style: LineStyle = "solid",
) -> None:
    _ = ax.plot(  # pyright: ignore[reportUnknownMemberType]  # Upstream drawing kwargs.
        [p[0] for p in vertices],
        [p[1] for p in vertices],
        color=INK_COLOR,
        lw=width,
        linestyle=LINE_STYLES[line_style],
        zorder=3,
    )


def _sample(start: float, end: float, count: int = 700) -> tuple[float, ...]:
    return tuple(start + (end - start) * index / (count - 1) for index in range(count))


def _ellipse_arc_points(arc: RecipeEllipseArc) -> tuple[Point, ...]:
    rotation = math.radians(arc.rotation_degrees)
    cosine, sine = math.cos(rotation), math.sin(rotation)
    count = max(16, math.ceil((arc.end_degrees - arc.start_degrees) * 700 / 360))
    return tuple(
        (
            arc.center[0]
            + arc.radii[0] * math.cos(t) * cosine
            - arc.radii[1] * math.sin(t) * sine,
            arc.center[1]
            + arc.radii[0] * math.cos(t) * sine
            + arc.radii[1] * math.sin(t) * cosine,
        )
        for t in _sample(
            math.radians(arc.start_degrees), math.radians(arc.end_degrees), count
        )
    )


def _draw_path_arrows(ax: Axes, vertices: tuple[Point, ...], arrow: ArrowStyle) -> None:
    if arrow == "none":
        return
    displayed = tuple(_display(ax, point) for point in vertices)
    length = sum(math.dist(first, last) for first, last in pairwise(displayed))
    # A closed path ends at its first vertex along the implicit closing edge.
    _draw_arrow_head(ax, vertices[-2], vertices[-1], available_length_px=length)
    if arrow == "both":
        _draw_arrow_head(ax, vertices[1], vertices[0], available_length_px=length)


def _arrow_shaft(
    ax: Axes, vertices: tuple[Point, ...], arrow: ArrowStyle
) -> tuple[Point, ...]:
    """Stop the shaft inside each head, including densely sampled curved paths."""
    if arrow == "none":
        return vertices
    displayed = tuple(_display(ax, point) for point in vertices)
    total = sum(math.dist(first, last) for first, last in pairwise(displayed))
    inset = min(ARROW_HEAD_PT * PT, total * 0.3) * ARROW_NOTCH_FRACTION

    def trim_start(points: tuple[Point, ...]) -> tuple[Point, ...]:
        remaining = inset
        for index, (first, last) in enumerate(pairwise(points)):
            distance = math.dist(first, last)
            if distance > remaining:
                fraction = remaining / distance
                tip = (
                    first[0] + (last[0] - first[0]) * fraction,
                    first[1] + (last[1] - first[1]) * fraction,
                )
                return (tip, *points[index + 1 :])
            remaining -= distance
        return points

    trimmed = tuple(reversed(trim_start(tuple(reversed(displayed)))))
    if arrow == "both":
        trimmed = trim_start(trimmed)
    return tuple(_data(ax, point) for point in trimmed)


def _draw_path(
    ax: Axes, path: RecipePath
) -> tuple[tuple[Point, ...], tuple[Point, ...]]:
    vertices = path.vertices + (path.vertices[:1] if path.closed else ())
    if path.stroke:
        _stroke(ax, _arrow_shaft(ax, vertices, path.arrow), line_style=path.line_style)
        _draw_path_arrows(ax, vertices, path.arrow)
    if path.fill:
        _ = ax.fill(  # pyright: ignore[reportUnknownMemberType]  # Upstream drawing kwargs.
            [point[0] for point in vertices],
            [point[1] for point in vertices],
            color=FILL_COLOR,
            linewidth=0,
            zorder=1,
        )
    anchors = (vertices[len(vertices) // 2], vertices[len(vertices) // 3])
    fallback = tuple(
        point
        for point in dict.fromkeys(
            vertices[int(fraction * (len(vertices) - 1))]
            for fraction in (0.15, 0.25, 0.4, 0.6, 0.75, 0.85)
        )
        if point not in anchors
    )
    return anchors, fallback


def _draw_scene(
    ax: Axes,
    recipe: FigureRecipe,
    fallback_anchors: dict[str, tuple[Point, ...]] | None = None,
) -> dict[str, tuple[Point, ...]]:
    points = dict(recipe.points)
    anchors: dict[str, tuple[Point, ...]] = {
        key: (value,) for key, value in points.items()
    }
    xmin, xmax, ymin, ymax = recipe.view
    for curve in recipe.curves:
        fn = curve_function(curve)
        xx = _sample(*curve.plot_domain)
        vertices: list[Point] = []
        for x in xx:
            y = fn(x)
            # Do not connect across undefined values or off-screen asymptotic jumps.
            if not math.isfinite(y) or not ymin - (ymax - ymin) <= y <= ymax + (
                ymax - ymin
            ):
                y = math.nan
            vertices.append((x, y))
        _stroke(ax, tuple(vertices), CURVE_LINE_PT, curve.line_style)
        if curve.fill_domain is not None:
            fx = _sample(*curve.fill_domain, 500)
            fy = tuple(fn(x) for x in fx)
            if not all(math.isfinite(y) for y in fy):
                msg = "fill crosses an undefined curve; split the recipe domain"
                raise FigureRecipeError(msg)
            _ = ax.fill_between(fx, 0, fy, color=FILL_COLOR, linewidth=0, zorder=1)  # pyright: ignore[reportUnknownMemberType]  # Upstream drawing kwargs.
        candidates = tuple(
            vertices[int(fraction * (len(vertices) - 1))]
            for fraction in (0.64, 0.75, 0.48, 0.85, 0.3, 0.92, 0.95, 0.15)
        )
        preferred = tuple(
            p
            for p in candidates
            if math.isfinite(p[1]) and xmin <= p[0] <= xmax and ymin <= p[1] <= ymax
        )
        # Keep successful historical placements first. A narrow visible portion
        # can lie between all full-domain samples, so evaluate the intersection
        # of the viewport and the declared curve domain independently.
        visible_domain = (
            max(xmin, curve.plot_domain[0]),
            min(xmax, curve.plot_domain[1]),
        )
        visible = (
            tuple(
                (x, y)
                for x in _sample(*visible_domain)
                if math.isfinite(y := fn(x)) and ymin <= y <= ymax
            )
            if visible_domain[0] <= visible_domain[1]
            else ()
        )
        fallback = (
            tuple(
                visible[int(fraction * (len(visible) - 1))]
                for fraction in (0.64, 0.75, 0.48, 0.85, 0.3, 0.92, 0.95, 0.15)
            )
            if visible
            else ()
        )
        anchors[curve.id] = preferred
        if fallback_anchors is not None:
            fallback_anchors[curve.id] = tuple(
                p for p in dict.fromkeys(fallback) if p not in preferred
            )
    for path in recipe.paths:
        anchors[path.id], path_fallback = _draw_path(ax, path)
        if fallback_anchors is not None:
            fallback_anchors[path.id] = path_fallback
    for ellipse in recipe.ellipses:
        _ = ax.add_patch(
            Ellipse(
                ellipse.center,
                2 * ellipse.radii[0],
                2 * ellipse.radii[1],
                angle=ellipse.rotation_degrees,
                facecolor=FILL_COLOR if ellipse.fill else "none",
                edgecolor=INK_COLOR,
                lw=MAIN_LINE_PT,
                linestyle=LINE_STYLES[ellipse.line_style],
                zorder=2,
            )
        )
        rotation = math.radians(ellipse.rotation_degrees)
        anchors[ellipse.id] = tuple(
            (
                ellipse.center[0]
                + ellipse.radii[0] * math.cos(t) * math.cos(rotation)
                - ellipse.radii[1] * math.sin(t) * math.sin(rotation),
                ellipse.center[1]
                + ellipse.radii[0] * math.cos(t) * math.sin(rotation)
                + ellipse.radii[1] * math.sin(t) * math.cos(rotation),
            )
            for t in (math.pi / 4, 3 * math.pi / 4)
        )
    for arc in recipe.ellipse_arcs:
        arc_vertices = _ellipse_arc_points(arc)
        _stroke(ax, arc_vertices, line_style=arc.line_style)
        anchors[arc.id] = tuple(
            arc_vertices[int(fraction * (len(arc_vertices) - 1))]
            for fraction in (0.5, 0.35, 0.65, 0.2, 0.8)
        )
        if fallback_anchors is not None:
            fallback_anchors[arc.id] = tuple(
                arc_vertices[int(fraction * (len(arc_vertices) - 1))]
                for fraction in (0.1, 0.9, 0.05, 0.95)
            )
    for start, end in recipe.segments:
        _stroke(ax, (points[start], points[end]))
    for stroke in recipe.strokes:
        first, last = points[stroke.start], points[stroke.end]
        anchors[stroke.id] = tuple(
            (
                first[0] + (last[0] - first[0]) * fraction,
                first[1] + (last[1] - first[1]) * fraction,
            )
            for fraction in (0.5, 0.35, 0.65, 0.2, 0.8)
        )
        if fallback_anchors is not None:
            fallback_anchors[stroke.id] = tuple(
                (
                    first[0] + (last[0] - first[0]) * fraction,
                    first[1] + (last[1] - first[1]) * fraction,
                )
                for fraction in (0.1, 0.9, 0.05, 0.95)
            )
    for axis in recipe.axes:
        start, end = (
            ((xmin, 0.0), (xmax, 0.0)) if axis == "x" else ((0.0, ymin), (0.0, ymax))
        )
        _stroke(ax, _arrow_shaft(ax, (start, end), "end"), AXIS_LINE_PT)
        _draw_arrow_head(ax, start, end)
        anchors["axis_" + axis] = (end,)
    _draw_point_markers(ax, recipe, points)
    return anchors


def _draw_point_markers(
    ax: Axes, recipe: FigureRecipe, points: dict[str, Point]
) -> None:
    if recipe.point_markers is None and recipe.axes:
        for point in points.values():
            _ = ax.plot(  # pyright: ignore[reportUnknownMemberType]  # Upstream drawing kwargs.
                point[0], point[1], "o", color=INK_COLOR, markersize=1.7, zorder=4
            )
    elif recipe.point_markers is not None:
        # A filled point takes precedence at coincident coordinates, independent
        # of JSON member order. The opaque white open center masks every curve.
        for marker in ("open", "filled"):
            for name, style in recipe.point_markers:
                if style != marker:
                    continue
                point = points[name]
                _ = ax.plot(  # pyright: ignore[reportUnknownMemberType]  # Upstream drawing kwargs.
                    point[0],
                    point[1],
                    "o",
                    markerfacecolor="white" if marker == "open" else INK_COLOR,
                    markeredgecolor=INK_COLOR,
                    markeredgewidth=MAIN_LINE_PT,
                    markersize=3.4,
                    zorder=5 if marker == "open" else 5.1,
                )


def _draw_marks(
    ax: Axes, recipe: FigureRecipe, anchors: dict[str, tuple[Point, ...]]
) -> None:
    points = dict(recipe.points)
    for stroke in recipe.strokes:
        start, end = points[stroke.start], points[stroke.end]
        first, last = _display(ax, start), _display(ax, end)
        along = _unit((last[0] - first[0], last[1] - first[1]))
        inset = (
            min(ARROW_HEAD_PT * PT, math.dist(first, last) * 0.3) * ARROW_NOTCH_FRACTION
        )
        # End the shaft inside its head so round line caps cannot blunt the tip.
        shaft_start = (
            _data(ax, (first[0] + along[0] * inset, first[1] + along[1] * inset))
            if stroke.arrow == "both"
            else start
        )
        shaft_end = (
            _data(ax, (last[0] - along[0] * inset, last[1] - along[1] * inset))
            if stroke.arrow in {"end", "both"}
            else end
        )
        _stroke(
            ax,
            (shaft_start, shaft_end),
            AUX_LINE_PT if stroke.line_style != "solid" else MAIN_LINE_PT,
            stroke.line_style,
        )
        if stroke.arrow in {"end", "both"}:
            _draw_arrow_head(ax, start, end)
        if stroke.arrow == "both":
            _draw_arrow_head(ax, end, start)
    marks = (
        *((start, end, 1) for start, end in recipe.equal_marks),
        *((mark.start, mark.end, mark.count) for mark in recipe.tick_marks),
    )
    for start, end, count in marks:
        first, last = _display(ax, points[start]), _display(ax, points[end])
        middle = ((first[0] + last[0]) / 2, (first[1] + last[1]) / 2)
        along = _unit((last[0] - first[0], last[1] - first[1]))
        normal = (-along[1] * 2.5 * PT, along[0] * 2.5 * PT)
        for index in range(count):
            offset = (index - (count - 1) / 2) * 2.1 * PT
            center = (middle[0] + along[0] * offset, middle[1] + along[1] * offset)
            _stroke(
                ax,
                (
                    _data(ax, (center[0] - normal[0], center[1] - normal[1])),
                    _data(ax, (center[0] + normal[0], center[1] + normal[1])),
                ),
                AUX_LINE_PT,
            )
    for mark in recipe.right_angles:
        vertex = _display(ax, points[mark.vertex])
        a, b = _display(ax, points[mark.ray1]), _display(ax, points[mark.ray2])
        first, last = (
            _unit((a[0] - vertex[0], a[1] - vertex[1])),
            _unit((b[0] - vertex[0], b[1] - vertex[1])),
        )
        size = 4.5 * PT
        _stroke(
            ax,
            tuple(
                _data(ax, p)
                for p in (
                    (vertex[0] + first[0] * size, vertex[1] + first[1] * size),
                    (
                        vertex[0] + (first[0] + last[0]) * size,
                        vertex[1] + (first[1] + last[1]) * size,
                    ),
                    (vertex[0] + last[0] * size, vertex[1] + last[1] * size),
                )
            ),
            AUX_LINE_PT,
        )
    for mark in recipe.angle_marks:
        geometry = _angle_geometry(ax, mark, points)
        arc = tuple(
            _data(
                ax,
                (
                    geometry.vertex[0] + geometry.radius_px * math.cos(t),
                    geometry.vertex[1] + geometry.radius_px * math.sin(t),
                ),
            )
            for t in _sample(geometry.start, geometry.start + geometry.sweep, 110)
        )
        _stroke(ax, arc, AUX_LINE_PT)
        anchors[mark.id] = (arc[82], arc[27], arc[-1], arc[0])


def _draw_arrow_head(
    ax: Axes, start: Point, end: Point, *, available_length_px: float | None = None
) -> None:
    """Add the same recessed, physical-size dart to axes and other arrows."""
    first, last = _display(ax, start), _display(ax, end)
    along = _unit((last[0] - first[0], last[1] - first[1]))
    length = min(
        ARROW_HEAD_PT * PT,
        (math.dist(first, last) if available_length_px is None else available_length_px)
        * 0.3,
    )
    half_width = length * ARROW_HALF_WIDTH_RATIO
    base = (last[0] - along[0] * length, last[1] - along[1] * length)
    notch = (
        last[0] - along[0] * length * ARROW_NOTCH_FRACTION,
        last[1] - along[1] * length * ARROW_NOTCH_FRACTION,
    )
    vertices = (
        end,
        _data(ax, (base[0] - along[1] * half_width, base[1] + along[0] * half_width)),
        _data(ax, notch),
        _data(ax, (base[0] + along[1] * half_width, base[1] - along[0] * half_width)),
    )
    _ = ax.add_patch(Polygon(vertices, facecolor=INK_COLOR, edgecolor="none", zorder=3))


def _raster(canvas: FigureCanvasAgg) -> Image.Image:
    canvas.draw()
    width, height = canvas.get_width_height()
    return Image.frombytes(
        "RGBA", (width, height), canvas.buffer_rgba().tobytes()
    ).convert("RGB")


def _clear(
    box: Bbox, mask: Image.Image, boxes: list[Bbox], clearance: float = 1.7
) -> bool:
    padded = box.padded(clearance * PT)
    left, bottom, right, top = padded.extents
    if (
        left < PAD
        or bottom < PAD
        or right > mask.width - PAD
        or top > mask.height - PAD
    ):
        return False
    rectangle = (
        math.floor(left),
        mask.height - math.ceil(top),
        math.ceil(right),
        mask.height - math.floor(bottom),
    )
    return mask.crop(rectangle).getbbox() is None and not any(
        padded.overlaps(other) for other in boxes
    )


def _point_name_text(text: str, target_is_point: bool) -> str:
    """Set only a simple point name upright without changing formulas at points."""
    match = SIMPLE_POINT_NAME.fullmatch(text) if target_is_point else None
    if match is None:
        return text
    return rf"$\mathrm{{{match.group(1)}}}{match.group(2) or ''}$"


def _point_box_distance(anchor: Point, box: Bbox) -> float:
    left, bottom, right, top = box.extents
    dx = max(left - anchor[0], 0.0, anchor[0] - right)
    dy = max(bottom - anchor[1], 0.0, anchor[1] - top)
    return math.hypot(dx, dy)


def _ray_distance(dx: float, dy: float, angle: float) -> float:
    """Measure a point's distance from a half-ray, including reflex sectors."""
    along = dx * math.cos(angle) + dy * math.sin(angle)
    return (
        math.hypot(dx, dy)
        if along <= 0
        else abs(dx * math.sin(angle) - dy * math.cos(angle))
    )


def _point_owner_clear(
    ax: Axes,
    label: RecipeLabel,
    box: Bbox,
    points: dict[str, Point],
    named_targets: frozenset[str],
) -> bool:
    if label.target not in named_targets:
        return True
    owner = _display(ax, points[label.target])
    owner_distance = _point_box_distance(owner, box)
    for name in named_targets - {label.target}:
        other = _display(ax, points[name])
        if math.dist(owner, other) < 0.25 * PT:
            continue
        if (
            _point_box_distance(other, box) + POINT_OWNER_MARGIN_PT * PT
            < owner_distance
        ):
            return False
    return True


def _axis_coordinate_sides(
    recipe: FigureRecipe, label: RecipeLabel, points: dict[str, Point]
) -> tuple[tuple[int, int], ...]:
    """Keep a coordinate formula on its requested side of a drawn axis."""
    if (
        recipe.label_placement != "anchored"
        or label.target not in points
        or SIMPLE_POINT_NAME.fullmatch(
            label.text if "$" in label.text else f"${label.text}$"
        )
        is not None
        or HANGUL.search(label.text) is not None
    ):
        return ()
    x, y = points[label.target]
    dx, dy = DIRECTIONS[label.preferred_direction]
    sides: list[tuple[int, int]] = []
    if "x" in recipe.axes and abs(y) < 1e-9 and dy:
        sides.append((1, int(dy)))
    if "y" in recipe.axes and abs(x) < 1e-9 and dx:
        sides.append((0, int(dx)))
    return tuple(sides)


def _box_on_axis_sides(
    box: Bbox, anchor: Point, sides: tuple[tuple[int, int], ...]
) -> bool:
    maximum_gap = AXIS_COORDINATE_MAX_GAP_PT * PT
    for coordinate, sign in sides:
        if coordinate == 0:
            if sign < 0 and not 0 < anchor[0] - box.x1 <= maximum_gap:
                return False
            if sign > 0 and not 0 < box.x0 - anchor[0] <= maximum_gap:
                return False
        else:
            if sign < 0 and not 0 < anchor[1] - box.y1 <= maximum_gap:
                return False
            if sign > 0 and not 0 < box.y0 - anchor[1] <= maximum_gap:
                return False
    return True


def _angle_box_clear(box: Bbox, geometry: _AngleGeometry) -> bool:
    """Keep the label in its own angle and close enough to identify its arc."""
    if _point_box_distance(geometry.vertex, box) < (
        geometry.radius_px + ANGLE_ARC_GAP_PT * PT
    ):
        return False
    left, bottom, right, top = box.extents
    for corner in ((left, bottom), (left, top), (right, bottom), (right, top)):
        dx, dy = corner[0] - geometry.vertex[0], corner[1] - geometry.vertex[1]
        distance = math.hypot(dx, dy)
        if distance <= 0:
            return False
        direction = math.atan2(dy, dx)
        progress = (
            (direction - geometry.start) % (2 * math.pi)
            if geometry.sweep > 0
            else (geometry.start - direction) % (2 * math.pi)
        )
        if progress > abs(geometry.sweep):
            return False
        edge_distance = min(
            _ray_distance(dx, dy, geometry.start),
            _ray_distance(dx, dy, geometry.start + geometry.sweep),
        )
        if edge_distance < ANGLE_RAY_CLEARANCE_PT * PT:
            return False
    return (
        min(
            _point_box_distance(
                (
                    geometry.vertex[0]
                    + geometry.radius_px
                    * math.cos(geometry.start + fraction * geometry.sweep),
                    geometry.vertex[1]
                    + geometry.radius_px
                    * math.sin(geometry.start + fraction * geometry.sweep),
                ),
                box,
            )
            for fraction in (index / 32 for index in range(33))
        )
        <= ANGLE_LABEL_MAX_GAP_PT * PT
    )


def _clear_ink(
    artist: Text,
    canvas: FigureCanvasAgg,
    box: Bbox,
    mask: Image.Image,
    boxes: list[Bbox],
    clearance_pt: float,
) -> bool:
    """Retry a rejected text rectangle using its visible glyph pixels."""
    padded = box.padded(clearance_pt * PT)
    left, bottom, right, top = padded.extents
    if (
        left < PAD
        or bottom < PAD
        or right > mask.width - PAD
        or top > mask.height - PAD
        or any(padded.overlaps(other) for other in boxes)
    ):
        return False
    renderer = canvas.get_renderer()
    renderer.clear()
    artist.draw(renderer)
    rgba = Image.frombytes(
        "RGBA", canvas.get_width_height(), renderer.buffer_rgba().tobytes()
    )
    rectangle = (
        max(0, math.floor(left)),
        max(0, mask.height - math.ceil(top)),
        min(mask.width, math.ceil(right)),
        min(mask.height, mask.height - math.floor(bottom)),
    )
    glyphs = rgba.getchannel("A").crop(rectangle)
    glyphs = glyphs.point([255 if level > 40 else 0 for level in range(256)])
    dilation = 2 * math.ceil(clearance_pt * PT) + 1
    expanded = glyphs.filter(ImageFilter.MaxFilter(dilation))
    return ImageChops.multiply(expanded, mask.crop(rectangle)).getbbox() is None


@dataclass(slots=True)
class _NearbyPointLabelSearch:
    ax: Axes
    canvas: FigureCanvasAgg
    artist: Text
    mask: Image.Image
    occupied_boxes: list[Bbox]
    anchor_groups: tuple[tuple[Point, ...], tuple[Point, ...]]
    size: Point
    text_offset: Point
    gap: float

    def _collect(
        self,
        vectors: tuple[Point, ...],
        rings: tuple[float, ...],
        accept_box: Callable[[Bbox], bool] | None = None,
    ) -> list[tuple[float, Point, Bbox]]:
        found: list[tuple[float, Point, Bbox]] = []
        ink_fallbacks: list[tuple[float, Point, Bbox]] = []
        width, height = self.size
        renderer = self.canvas.get_renderer()
        for group in self.anchor_groups:
            for anchor_index, point in enumerate(group):
                anchor = _display(self.ax, point)
                for ring in rings:
                    for direction_index, (dx, dy) in enumerate(vectors):
                        center = (
                            anchor[0]
                            + dx * (width / 2 + (self.gap + ring) * PT)
                            - self.text_offset[0],
                            anchor[1]
                            + dy * (height / 2 + (self.gap + ring) * PT)
                            - self.text_offset[1],
                        )
                        self.artist.set_position(center)
                        box = self.artist.get_window_extent(renderer)
                        if accept_box is not None and not accept_box(box):
                            continue
                        candidate = (
                            ring * 100 + direction_index * 8 + anchor_index * 2,
                            center,
                            box,
                        )
                        if _clear(box, self.mask, self.occupied_boxes, 0.7):
                            found.append(candidate)
                        else:
                            ink_fallbacks.append(candidate)
            if found:
                break
        if not found:
            for candidate in sorted(ink_fallbacks, key=lambda item: item[0]):
                self.artist.set_position(candidate[1])
                if _clear_ink(
                    self.artist,
                    self.canvas,
                    candidate[2],
                    self.mask,
                    self.occupied_boxes,
                    0.7,
                ):
                    found.append(candidate)
                    break
        return found

    def find(
        self,
        preferred: str,
        directions: tuple[str, ...],
        original_rings: tuple[float, ...],
        *,
        accept_box: Callable[[Bbox], bool] | None = None,
    ) -> list[tuple[float, Point, Bbox]]:
        # Existing placements have already failed. Keep the extra search near
        # the point, with no line erasure, masking, or change of font size.
        found = self._collect(
            tuple(DIRECTIONS[key] for key in directions), (14, 16), accept_box
        )
        if found:
            return found
        preferred_vector = DIRECTIONS[preferred]
        preferred_angle = math.atan2(preferred_vector[1], preferred_vector[0])
        angles = sorted(
            (index * math.pi / 12 for index in range(24) if index % 3),
            key=lambda angle: abs(
                (angle - preferred_angle + math.pi) % (2 * math.pi) - math.pi
            ),
        )
        found = self._collect(
            tuple((math.cos(angle), math.sin(angle)) for angle in angles),
            (*original_rings, 14, 16),
            accept_box,
        )
        if found:
            return found
        # The rings start half a text box away from the anchor. A wide label
        # inside a clear region can need a smaller, independent x/y translation.
        # Fill that central search hole without increasing the distance budget
        # or relaxing ink, ownership, axis-side, or occupied-label checks.
        width, height = self.size
        vectors = sorted(
            ((x / 8, y / 8) for x in range(-8, 9) for y in range(-8, 9)),
            key=lambda vector: (
                math.hypot(
                    vector[0] * (width / 2 + self.gap * PT),
                    vector[1] * (height / 2 + self.gap * PT),
                ),
                -(vector[0] * preferred_vector[0] + vector[1] * preferred_vector[1]),
            ),
        )
        return self._collect(tuple(vectors), (0,), accept_box)


def _ordered_labels(
    recipe: FigureRecipe,
    *,
    reverse_geometry: bool,
    prioritize_wide_points: bool,
    prioritize_angles: bool,
) -> list[RecipeLabel]:
    point_ids = dict(recipe.points)
    angle_ids = {mark.id for mark in recipe.angle_marks}
    labels = sorted(
        recipe.visible_annotations,
        key=lambda item: (item.target in angle_ids, item.target not in point_ids),
    )
    if prioritize_wide_points and recipe.label_placement == "anchored":
        labels = [
            *(
                sorted(
                    (label for label in labels if label.target in point_ids),
                    key=lambda label: -len(label.text),
                )
            ),
            *(label for label in labels if label.target not in point_ids),
        ]
    if reverse_geometry:
        geometry_ids = {
            *(curve.id for curve in recipe.curves),
            *(path.id for path in recipe.paths),
            *(ellipse.id for ellipse in recipe.ellipses),
            *(arc.id for arc in recipe.ellipse_arcs),
            *(stroke.id for stroke in recipe.strokes),
        }
        labels = [
            *(label for label in labels if label.target in point_ids),
            *(label for label in reversed(labels) if label.target in geometry_ids),
            *(
                label
                for label in labels
                if label.target not in point_ids
                and label.target not in geometry_ids
                and label.target not in angle_ids
            ),
            *(label for label in labels if label.target in angle_ids),
        ]
    # Reserve the constrained angular sectors before unconstrained text uses them.
    if prioritize_angles or angle_ids:
        labels = sorted(labels, key=lambda label: label.target not in angle_ids)
    return labels


def _place_angle_label(
    canvas: FigureCanvasAgg,
    artist: Text,
    geometry: _AngleGeometry,
    mask: Image.Image,
    boxes: list[Bbox],
    size: Point,
    text_offset: Point,
) -> tuple[Point, Bbox] | None:
    """Search outward from the marked angle's bisector without changing it."""
    renderer = canvas.get_renderer()
    direction = geometry.start + geometry.sweep / 2
    half_diagonal = math.hypot(*size) / 2
    ink_fallbacks: list[tuple[Point, Bbox]] = []
    sector_fallbacks: list[tuple[Point, Bbox]] = []
    for extra_pt in range(math.ceil(ANGLE_LABEL_MAX_GAP_PT) + 1):
        radius = (
            geometry.radius_px + ANGLE_ARC_GAP_PT * PT + half_diagonal + extra_pt * PT
        )
        for fraction in (
            0.0,
            -0.08,
            0.08,
            -0.16,
            0.16,
            -0.25,
            0.25,
            -0.32,
            0.32,
        ):
            angle = direction + fraction * geometry.sweep
            position = (
                geometry.vertex[0] + radius * math.cos(angle) - text_offset[0],
                geometry.vertex[1] + radius * math.sin(angle) - text_offset[1],
            )
            artist.set_position(position)
            box = artist.get_window_extent(renderer)
            if not _angle_box_clear(box, geometry):
                sector_fallbacks.append((position, box))
                continue
            if _clear(box, mask, boxes, 0.7):
                return position, box
            if len(ink_fallbacks) < 24:
                ink_fallbacks.append((position, box))
    for position, box in ink_fallbacks:
        artist.set_position(position)
        if _clear_ink(artist, canvas, box, mask, boxes, 0.7):
            return position, box
    # Superscripts leave empty corners in their rectangle. Check the actual ink
    # before rejecting a narrow sector; retain the same arc/ray clearance limits.
    ink_points = _angle_label_ink(canvas, artist, text_offset)
    for position, box in sector_fallbacks:
        center = (position[0] + text_offset[0], position[1] + text_offset[1])
        if not _angle_ink_clear(ink_points, center, geometry):
            continue
        artist.set_position(position)
        if _clear_ink(artist, canvas, box, mask, boxes, 0.7):
            return position, box
    # A feasible interval can be narrower than the initial one-point radius grid.
    # Refine only failed placements, keeping the same maximum radius and gaps.
    fractions = sorted(range(-16, 17), key=abs)
    for step in range(4 * math.ceil(ANGLE_LABEL_MAX_GAP_PT) + 1):
        radius = (
            geometry.radius_px + ANGLE_ARC_GAP_PT * PT + half_diagonal + step * PT / 4
        )
        for fraction in fractions:
            angle = direction + fraction * 0.025 * geometry.sweep
            center = (
                geometry.vertex[0] + radius * math.cos(angle),
                geometry.vertex[1] + radius * math.sin(angle),
            )
            if not _angle_ink_clear(ink_points, center, geometry):
                continue
            position = (center[0] - text_offset[0], center[1] - text_offset[1])
            artist.set_position(position)
            box = artist.get_window_extent(renderer)
            if _clear_ink(artist, canvas, box, mask, boxes, 0.7):
                return position, box
    return None


def _angle_label_ink(
    canvas: FigureCanvasAgg, artist: Text, text_offset: Point
) -> tuple[Point, ...]:
    """Rasterize once in the canvas center to avoid clipping the measured ink."""
    width, height = canvas.get_width_height()
    position = (width / 2, height / 2)
    artist.set_position(position)
    renderer = canvas.get_renderer()
    renderer.clear()
    artist.draw(renderer)
    alpha = Image.frombytes(
        "RGBA", (width, height), renderer.buffer_rgba().tobytes()
    ).getchannel("A")
    bounds = alpha.getbbox()
    if bounds is None:
        return ()
    return tuple(
        (
            x + 0.5 - position[0] - text_offset[0],
            height - y - 0.5 - position[1] - text_offset[1],
        )
        for y in range(bounds[1], bounds[3])
        for x in range(bounds[0], bounds[2])
        if cast("int", alpha.getpixel((x, y))) > 40
    )


def _angle_ink_clear(
    points: tuple[Point, ...], center: Point, geometry: _AngleGeometry
) -> bool:
    """Keep every visible glyph pixel within its sector, clear of rays and arc."""
    if not points:
        return False
    pixel_margin = math.sqrt(0.5)
    nearest = math.inf
    for x, y in points:
        dx = center[0] + x - geometry.vertex[0]
        dy = center[1] + y - geometry.vertex[1]
        distance = math.hypot(dx, dy)
        direction = math.atan2(dy, dx)
        progress = (
            (direction - geometry.start) % (2 * math.pi)
            if geometry.sweep > 0
            else (geometry.start - direction) % (2 * math.pi)
        )
        if (
            progress > abs(geometry.sweep)
            or distance < geometry.radius_px + ANGLE_ARC_GAP_PT * PT + pixel_margin
            or min(
                _ray_distance(dx, dy, geometry.start),
                _ray_distance(dx, dy, geometry.start + geometry.sweep),
            )
            < ANGLE_RAY_CLEARANCE_PT * PT + pixel_margin
        ):
            return False
        nearest = min(nearest, distance - geometry.radius_px)
    return nearest + pixel_margin <= ANGLE_LABEL_MAX_GAP_PT * PT


def _place_labels(  # noqa: PLR0915  # Placement checks shared scene, geometry, and occupied labels.
    ax: Axes,
    canvas: FigureCanvasAgg,
    recipe: FigureRecipe,
    anchors: dict[str, tuple[Point, ...]],
    fallback_anchors: dict[str, tuple[Point, ...]] | None = None,
    *,
    reverse_geometry: bool = False,
    prioritize_wide_points: bool = False,
    prioritize_angles: bool = False,
) -> tuple[tuple[Text, Bbox], ...]:
    scene = _raster(canvas)
    mask = scene.convert("L").point([255 if level < 210 else 0 for level in range(256)])
    renderer = canvas.get_renderer()
    boxes: list[Bbox] = []
    artists: list[tuple[Text, Bbox]] = []
    point_ids = dict(recipe.points)
    angles = {
        mark.id: _angle_geometry(ax, mark, point_ids) for mark in recipe.angle_marks
    }
    angle_ids = set(angles)
    labels = _ordered_labels(
        recipe,
        reverse_geometry=reverse_geometry,
        prioritize_wide_points=prioritize_wide_points,
        prioritize_angles=prioritize_angles,
    )
    named_targets = frozenset(
        label.target
        for label in labels
        if label.target in point_ids
        and SIMPLE_POINT_NAME.fullmatch(label.text) is not None
    )
    for label in labels:
        has_hangul = HANGUL.search(label.text) is not None
        text = (
            label.text
            if "$" in label.text or has_hangul
            else "$" + label.text.replace("°", r"^\circ") + "$"
        )
        text = MATH_TEXT_SINGLE_DIGIT_ROOT.sub(
            lambda match: rf"\sqrt{{{match.group(1)}}}", text
        )
        displayed_text = normalize_figure_math_aliases(
            normalize_figure_fractions(
                _point_name_text(text, label.target in point_ids)
            )
        )
        artist = ax.text(  # pyright: ignore[reportUnknownMemberType]  # Upstream drawing kwargs.
            0,
            0,
            displayed_text,
            transform=IdentityTransform(),
            ha="center",
            va="center",
            fontsize=LABEL_FONT_PT,
            fontfamily="HCR Batang" if has_hangul else "serif",
            snap=False,
            zorder=6,
        )
        artist.set_label(text)
        box = artist.get_window_extent(renderer)
        width, height = box.width, box.height
        text_offset = ((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)
        if label.target in angle_ids and recipe.label_placement == "anchored":
            placed = _place_angle_label(
                canvas,
                artist,
                angles[label.target],
                mask,
                boxes,
                (width, height),
                text_offset,
            )
            if placed is None:
                raise FigureRecipeError(
                    f"no readable label position inside angle: {label.id}"
                )
            position, box = placed
            artist.set_position(position)
            boxes.append(box)
            artists.append((artist, box))
            continue
        # Angle numerals stay adjacent to their arc; never add a connecting stroke.
        preferred = "E" if label.target in angle_ids else label.preferred_direction
        directions = [preferred, *(key for key in DIRECTIONS if key != preferred)]
        anchored = recipe.label_placement == "anchored" and (
            label.target in point_ids or label.target in {"axis_x", "axis_y"}
        )
        if anchored:
            compass = tuple(DIRECTIONS)
            preferred_index = compass.index(preferred)
            directions = sorted(
                directions,
                key=lambda direction: min(
                    (compass.index(direction) - preferred_index) % 8,
                    (preferred_index - compass.index(direction)) % 8,
                ),
            )
        rings = (
            (0, 0.75, 1.5, 3, 4.5, 6, 8, 10, 12) if anchored else (0, 3, 6, 10, 16, 23)
        )
        gap = 1.2 if anchored else 3
        axis_sides = _axis_coordinate_sides(recipe, label, point_ids)
        side_anchor = (
            _display(ax, point_ids[label.target]) if axis_sides else (0.0, 0.0)
        )
        wrong_side_readable = False
        candidates: list[tuple[float, Point, Bbox]] = []
        ink_fallbacks: list[tuple[float, Point, Bbox]] = []
        wrong_side_ink_fallbacks: list[tuple[Point, Bbox]] = []
        anchor_groups = (
            anchors[label.target],
            (fallback_anchors or {}).get(label.target, ()),
        )
        for group in anchor_groups:
            for anchor_index, point in enumerate(group):
                anchor = _display(ax, point)
                for ring in rings:
                    if label.target in angle_ids and ring > 6:
                        continue
                    for direction_index, direction in enumerate(directions):
                        dx, dy = DIRECTIONS[direction]
                        center = (
                            anchor[0] + dx * (width / 2 + (gap + ring) * PT),
                            anchor[1] + dy * (height / 2 + (gap + ring) * PT),
                        )
                        if anchored:
                            center = (
                                center[0] - text_offset[0],
                                center[1] - text_offset[1],
                            )
                        artist.set_position(center)
                        box = artist.get_window_extent(renderer)
                        if not _point_owner_clear(
                            ax, label, box, point_ids, named_targets
                        ):
                            continue
                        clearance = 0.7 if anchored else 1.7
                        on_side = _box_on_axis_sides(box, side_anchor, axis_sides)
                        candidate = (
                            ring
                            + (100 if anchored and ring > 6 else 0)
                            + direction_index * (8 if anchored else 2.2)
                            + anchor_index * 2,
                            center,
                            box,
                        )
                        if _clear(box, mask, boxes, clearance):
                            if on_side:
                                candidates.append(candidate)
                            else:
                                wrong_side_readable = True
                        elif on_side and len(ink_fallbacks) < 24:
                            ink_fallbacks.append(candidate)
                        elif not on_side and len(wrong_side_ink_fallbacks) < 24:
                            wrong_side_ink_fallbacks.append((center, box))
            if candidates:
                break
        if not candidates:
            for candidate in sorted(ink_fallbacks, key=lambda item: item[0]):
                artist.set_position(candidate[1])
                if _clear_ink(
                    artist,
                    canvas,
                    candidate[2],
                    mask,
                    boxes,
                    0.7 if anchored else 1.7,
                ):
                    candidates.append(candidate)
                    break
        if not candidates and anchored and label.target in point_ids:
            candidates = _NearbyPointLabelSearch(
                ax,
                canvas,
                artist,
                mask,
                boxes,
                anchor_groups,
                (width, height),
                text_offset,
                gap,
            ).find(
                preferred,
                tuple(directions),
                rings,
                accept_box=lambda box, label=label, side_anchor=side_anchor, axis_sides=axis_sides: (
                    _point_owner_clear(ax, label, box, point_ids, named_targets)
                    and _box_on_axis_sides(box, side_anchor, axis_sides)
                ),
            )
            candidates = [
                candidate
                for candidate in candidates
                if _point_owner_clear(ax, label, candidate[2], point_ids, named_targets)
                and _box_on_axis_sides(candidate[2], side_anchor, axis_sides)
            ]
        if not candidates:
            if axis_sides and not wrong_side_readable:
                for position, box in wrong_side_ink_fallbacks:
                    artist.set_position(position)
                    if _clear_ink(artist, canvas, box, mask, boxes, 0.7):
                        wrong_side_readable = True
                        break
            if wrong_side_readable:
                raise FigureRecipeError(f"{AXIS_COORDINATE_SIDE_ERROR}: {label.id}")
            if anchored:
                raise FigureRecipeError(
                    f"no readable label position near anchor: {label.id}"
                )
            raise FigureRecipeError(f"no readable label position: {label.id}")
        _, center, box = min(candidates, key=lambda item: item[0])
        artist.set_position(center)
        boxes.append(box)
        artists.append((artist, box))
    return tuple(artists)


def _checked_math_rc() -> dict[RcKeyType, object]:
    try:
        return figure_math_rc()
    except (OSError, ValueError) as exc:
        raise FigureRecipeError(f"figure math font unavailable: {exc}") from exc


def _draw_figure_recipe_once(
    recipe: FigureRecipe, *, canvas_scale: float = 1.0, geometry_scale: float = 1.0
) -> RecipeDrawing:
    """Draw a fixed-style canvas without changing the recipe's data view."""
    with rc_context(
        {
            **_checked_math_rc(),
            "font.size": LABEL_FONT_PT,
            "lines.solid_capstyle": "round",
            "lines.scale_dashes": False,
        }
    ):
        fig = Figure(
            figsize=(
                64.4 * canvas_scale * geometry_scale / 25.4,
                55.6 * canvas_scale * geometry_scale / 25.4,
            ),
            dpi=DPI,
        )
        canvas = FigureCanvasAgg(fig)
        canvas.get_renderer().mathtext_parser = FigureMathTextParser()
        margin = (canvas_scale - 1) / 2
        ax = fig.add_axes(  # pyright: ignore[reportUnknownMemberType]  # Upstream drawing kwargs.
            (
                (0.085 + margin) / canvas_scale,
                (0.09 + margin) / canvas_scale,
                0.78 / canvas_scale,
                0.77 / canvas_scale,
            )
        )
        xmin, xmax, ymin, ymax = recipe.view
        _ = ax.set(xlim=(xmin, xmax), ylim=(ymin, ymax))
        ax.set_axis_off()
        if recipe.equal_aspect:
            ax.set_aspect("equal", adjustable="box")
        fallback_anchors: dict[str, tuple[Point, ...]] = {}
        anchors = _draw_scene(ax, recipe, fallback_anchors)
        canvas.draw()
        _draw_marks(ax, recipe, anchors)
        try:
            existing_texts = {id(artist) for artist in ax.texts}
            try:
                labels = _place_labels(ax, canvas, recipe, anchors, fallback_anchors)
            except FigureRecipeError as exc:
                if not str(exc).startswith("no readable label position"):
                    raise
                for artist in tuple(ax.texts):
                    if id(artist) not in existing_texts:
                        artist.remove()
                try:
                    labels = _place_labels(
                        ax,
                        canvas,
                        recipe,
                        anchors,
                        fallback_anchors,
                        reverse_geometry=True,
                    )
                except FigureRecipeError as retry_error:
                    if not str(retry_error).startswith("no readable label position"):
                        raise
                    for artist in tuple(ax.texts):
                        if id(artist) not in existing_texts:
                            artist.remove()
                    try:
                        labels = _place_labels(
                            ax,
                            canvas,
                            recipe,
                            anchors,
                            fallback_anchors,
                            prioritize_wide_points=True,
                        )
                    except FigureRecipeError as wide_error:
                        if not str(wide_error).startswith("no readable label position"):
                            raise
                        for artist in tuple(ax.texts):
                            if id(artist) not in existing_texts:
                                artist.remove()
                        labels = _place_labels(
                            ax,
                            canvas,
                            recipe,
                            anchors,
                            fallback_anchors,
                            prioritize_angles=True,
                        )
            raster = _raster(canvas)
        except (ValueError, RuntimeError) as exc:
            raise FigureRecipeError(str(exc)) from exc
        bounds = ImageChops.difference(
            raster, Image.new("RGB", raster.size, "white")
        ).getbbox()
        if bounds is None:
            msg = "empty figure recipe"
            raise FigureRecipeError(msg)
        result = ImageOps.expand(raster.crop(bounds), border=PAD, fill="white")
        output = BytesIO()
        result.save(output, format="PNG", dpi=(DPI, DPI))
        return RecipeDrawing(
            output.getvalue(),
            tuple(cast("str", artist.get_label()) for artist, _ in labels),
            tuple(
                (float(box.x0), float(box.y0), float(box.x1), float(box.y1))
                for _, box in labels
            ),
            tuple((name, _display(ax, point)) for name, point in recipe.points),
        )


def _include_requested_axes(recipe: FigureRecipe) -> FigureRecipe:
    """Keep requested coordinate axes inside a cropped view with room for labels."""
    xmin, xmax, ymin, ymax = recipe.view
    x_margin = 0.1 * (xmax - xmin)
    y_margin = 0.1 * (ymax - ymin)
    if "y" in recipe.axes:
        if xmin > 0:
            xmin = -x_margin
        elif xmax < 0:
            xmax = x_margin
    if "x" in recipe.axes:
        if ymin > 0:
            ymin = -y_margin
        elif ymax < 0:
            ymax = y_margin
    if (xmin, xmax, ymin, ymax) == recipe.view:
        return recipe
    return dataclass_replace(recipe, view=(xmin, xmax, ymin, ymax))


def draw_figure_recipe(recipe: FigureRecipe) -> RecipeDrawing:
    """Keep anchored labels in place with bounded geometry scale retries."""
    recipe = _include_requested_axes(recipe)
    try:
        return _draw_figure_recipe_once(recipe)
    except FigureRecipeError as first_error:
        if not str(first_error).startswith(
            (AXIS_COORDINATE_SIDE_ERROR, "no readable label position")
        ):
            raise
        constrained = str(first_error).startswith(
            (
                AXIS_COORDINATE_SIDE_ERROR,
                "no readable label position inside angle:",
                "no readable label position near anchor:",
            )
        )
        geometry_scales = ((1.2, 1.0), (1.4, 1.0))
        canvas_scales = tuple((1.0, scale) for scale in (1.05, 1.1, 1.15, 1.2))
        # An unconstrained label can expose an axis/angle failure on a retry.
        # Keep both bounded remedies available instead of stopping on that change.
        scales = (
            *(geometry_scales if constrained else canvas_scales),
            *(canvas_scales if constrained else geometry_scales),
            *(
                (geometry, canvas)
                for geometry in (1.2, 1.4)
                for canvas in (1.05, 1.1, 1.15, 1.2)
            ),
        )
        last_error = first_error
        for geometry_scale, canvas_scale in scales:
            try:
                return _draw_figure_recipe_once(
                    recipe, geometry_scale=geometry_scale, canvas_scale=canvas_scale
                )
            except FigureRecipeError as retry_error:
                if not str(retry_error).startswith(
                    (AXIS_COORDINATE_SIDE_ERROR, "no readable label position")
                ):
                    raise
                last_error = retry_error
        raise last_error from first_error
