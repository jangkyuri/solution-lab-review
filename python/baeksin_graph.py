"""Baeksin's compact vector graph axes and direct labels."""

from __future__ import annotations

from math import isclose
from typing import TYPE_CHECKING

from baeksin_math import annotate_label
from graph_scene import MIN_CURVE_POINTS

if TYPE_CHECKING:
    from collections.abc import Mapping

    from matplotlib.axes import Axes

    from graph_scene import Graph, PrintBounds


def _draw_axes(
    axes: Axes, graph: Graph, crossing: tuple[float, float], color: str
) -> None:
    """Draw open axes and explicit scales at native column width."""
    axes.set_axis_off()
    axis_x, axis_y = crossing
    arrow = {"arrowstyle": "->", "color": color, "lw": 0.65}
    if axis_y == 0:
        _ = axes.annotate(
            "", (graph.x_max, axis_y), xytext=(graph.x_min, axis_y), arrowprops=arrow
        )
        annotate_label(
            axes,
            graph.x_label,
            (graph.x_max, axis_y),
            xytext=(-1, 3),
            textcoords="offset points",
            ha="right",
            color=color,
            fontsize=8,
        )
    if axis_x == 0:
        _ = axes.annotate(
            "", (axis_x, graph.y_max), xytext=(axis_x, graph.y_min), arrowprops=arrow
        )
        annotate_label(
            axes,
            graph.y_label,
            (axis_x, graph.y_max),
            xytext=(3, -1),
            textcoords="offset points",
            va="top",
            color=color,
            fontsize=8,
        )
    if graph.qualitative:
        return
    if axis_x == 0 and axis_y == 0:
        _ = axes.annotate(
            "0",
            (0, 0),
            xytext=(-3, 3),
            textcoords="offset points",
            ha="right",
            va="bottom",
            fontsize=7,
            color=color,
        )
    if (
        graph.verticals
        or graph.horizontals
        or any(
            point.label.strip()
            and graph.x_min <= point.x <= graph.x_max
            and graph.y_min <= point.y <= graph.y_max
            for point in graph.points
        )
    ):
        return
    # With no supplied guide, label one scale value on that axis.
    for dimension, lower, upper, fixed in (
        ("x", graph.x_min, graph.x_max, axis_y),
        ("y", graph.y_min, graph.y_max, axis_x),
    ):
        if fixed != 0:
            continue
        coordinate = lower + 0.75 * (upper - lower)
        rounded = float(f"{coordinate:.1g}")
        if lower < rounded < upper:
            coordinate = rounded
        if not lower < coordinate < upper or coordinate == 0:
            continue
        point = (coordinate, fixed) if dimension == "x" else (fixed, coordinate)
        marker = "|" if dimension == "x" else "_"
        _ = axes.plot([point[0]], [point[1]], marker=marker, markersize=3, color=color)
        _ = axes.annotate(
            f"{coordinate:g}",
            point,
            xytext=(3, -3),
            textcoords="offset points",
            va="top",
            fontsize=7,
            color=color,
        )


def _draw_guides(
    axes: Axes, graph: Graph, crossing: tuple[float, float], color: str
) -> None:
    """Project marked points onto their coordinate axes."""
    axis_x, axis_y = crossing
    for guide in graph.verticals:
        matching = [
            point.y
            for point in graph.points
            if isclose(point.x, guide.x) and graph.y_min <= point.y <= graph.y_max
        ]
        if matching:
            endpoints = [axis_y, *matching]
            if min(endpoints) == max(endpoints):
                _ = axes.plot(
                    [guide.x], [axis_y], marker="|", markersize=4, color=color
                )
            else:
                _ = axes.plot(
                    [guide.x, guide.x],
                    [min(endpoints), max(endpoints)],
                    color=color,
                    linewidth=0.65,
                    linestyle="--",
                )
        else:
            _ = axes.axvline(guide.x, color=color, linewidth=0.65, linestyle="--")
        above = axis_y == graph.y_min or bool(matching and max(matching) < axis_y)
        annotate_label(
            axes,
            guide.label,
            (guide.x, axis_y),
            xytext=(0, 3 if above else -3),
            textcoords="offset points",
            ha="left"
            if guide.x == graph.x_min
            else "right"
            if guide.x == graph.x_max
            else "center",
            va="bottom" if above else "top",
            fontsize=7,
            color=color,
        )
    for guide in graph.horizontals:
        matching = [
            point.x
            for point in graph.points
            if isclose(point.y, guide.y) and graph.x_min <= point.x <= graph.x_max
        ]
        if matching:
            endpoints = [axis_x, *matching]
            if min(endpoints) == max(endpoints):
                _ = axes.plot(
                    [axis_x], [guide.y], marker="_", markersize=4, color=color
                )
            else:
                _ = axes.plot(
                    [min(endpoints), max(endpoints)],
                    [guide.y, guide.y],
                    color=color,
                    linewidth=0.65,
                    linestyle="--",
                )
        else:
            _ = axes.axhline(guide.y, color=color, linewidth=0.65, linestyle="--")
        right = axis_x == graph.x_min
        annotate_label(
            axes,
            guide.label,
            (axis_x, guide.y),
            xytext=(3 if right else -3, 0),
            textcoords="offset points",
            ha="left" if right else "right",
            va="center",
            fontsize=7,
            color=color,
        )


def _label_curves(axes: Axes, graph: Graph, colors: Mapping[str, str]) -> None:
    """Attach labels to visible samples of each already-drawn curve."""
    for index, curve in enumerate(graph.curves):
        if not curve.label:
            continue
        x_target = graph.x_min + (0.65 - (index % 3) * 0.14) * (
            graph.x_max - graph.x_min
        )
        candidates = (
            point
            for segment in (curve.segments or (curve.samples,))
            if len(segment) >= MIN_CURVE_POINTS
            for point in segment
            if graph.x_min <= point.x <= graph.x_max
            and graph.y_min <= point.y <= graph.y_max
        )
        anchor = min(
            candidates, key=lambda point: abs(point.x - x_target), default=None
        )
        if anchor is not None:
            near_right = anchor.x > x_target
            near_top = anchor.y > graph.y_min + 0.72 * (graph.y_max - graph.y_min)
            annotate_label(
                axes,
                curve.label,
                (anchor.x, anchor.y),
                xytext=(-3 if near_right else 3, -3 if near_top else 3),
                textcoords="offset points",
                ha="right" if near_right else "left",
                va="top" if near_top else "bottom",
                fontsize=8,
                color=colors[curve.color],
            )


def draw_baeksin(
    axes: Axes, graph: Graph, colors: Mapping[str, str], highlight: PrintBounds | None
) -> None:
    """Use light axes with in-place labels for a narrow printed graph."""
    crossing = (
        min(graph.x_max, max(graph.x_min, 0.0)),
        min(graph.y_max, max(graph.y_min, 0.0)),
    )
    _draw_axes(axes, graph, crossing, colors["gray"])
    _draw_guides(axes, graph, crossing, colors["gray"])
    _label_curves(axes, graph, colors)
    if highlight is not None:
        left, right = highlight.x_min, highlight.x_max
        bottom, top = highlight.y_min, highlight.y_max
        _ = axes.plot(
            [left, right, right, left, left],
            [bottom, bottom, top, top, bottom],
            color=colors["blue"],
            linewidth=0.7,
            zorder=2.5,
        )
    for shade in graph.shades:
        x = sum(point.x for point in shade.polygon) / len(shade.polygon)
        y = sum(point.y for point in shade.polygon) / len(shade.polygon)
        annotate_label(
            axes,
            shade.label,
            (x, y),
            xytext=(-4, 0),
            textcoords="offset points",
            ha="right",
            va="center",
            fontsize=7,
            color=colors[shade.color],
        )
