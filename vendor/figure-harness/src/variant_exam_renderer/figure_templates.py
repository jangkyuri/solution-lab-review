"""Compile a finite catalog of atlas-inspired constructions into raw recipes.

Templates supply coordinates and relationships. Only the caller's explicit
``visible_annotations`` supply visible text; numerical construction parameters
never become labels automatically.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Final, cast

from variant_exam_renderer.figure_recipe import RECIPE_VERSION, FigureRecipeError
from variant_exam_renderer.figure_templates_diagrams import (
    build_mapping_chain,
    build_mapping_diagram,
    build_prism_section,
)
from variant_exam_renderer.figure_templates_geometry import (
    build_circle_tangent_chords,
    build_circular_seating,
    build_triangle_equal_segments,
)
from variant_exam_renderer.figure_templates_graphs import (
    build_hyperbola_foci,
    build_piecewise_density,
    build_piecewise_endpoints,
    build_polynomial_region,
    build_quadratic_line_enclosed_region,
    build_trig_guides,
)
from variant_exam_renderer.figure_templates_revolution import (
    build_cone_inscribed_cylinder,
)
from variant_exam_renderer.figure_templates_solids import (
    build_upright_cylinder_oblique_section,
)
from variant_exam_renderer.figure_templates_stacks import build_stacked_cubes
from variant_exam_renderer.figure_templates_venn import build_venn_regions


@dataclass(frozen=True, slots=True)
class FigureTemplate:
    """An executable family with a traceable official-atlas reference."""

    id: str
    title: str
    source_id: str
    scope: str
    build: Callable[[object], dict[str, object]]


FIGURE_TEMPLATES: Final[tuple[FigureTemplate, ...]] = (
    FigureTemplate(
        "polynomial_region",
        "포물선·할선·음영",
        "S002-P11-F01",
        "위로 열린 포물선과 두 교점의 할선, x축까지의 지정 구간 음영",
        build_polynomial_region,
    ),
    FigureTemplate(
        "quadratic_line_enclosed_region",
        "포물선·직선 사이 영역",
        "S010-P08-F01",
        "두 교점에서 만나는 이차함수와 직선; 명시한 경우에만 사이 영역 음영",
        build_quadratic_line_enclosed_region,
    ),
    FigureTemplate(
        "piecewise_endpoints",
        "구간별 함수·열린 점",
        "S030-P02-F01",
        "직선·상수·포물선의 세 구간과 명시적인 열린 점·채운 점",
        build_piecewise_endpoints,
    ),
    FigureTemplate(
        "trig_guides",
        "삼각함수·점선 보조선",
        "S029-P03-F01",
        "사인 함수의 진폭·주기·평행이동과 선택적 보조선",
        build_trig_guides,
    ),
    FigureTemplate(
        "piecewise_density",
        "구간별 확률밀도함수",
        "S072-P12-F02",
        "주어진 꼭짓점을 이은 비음수 꺾은선, 총넓이 1 검증",
        build_piecewise_density,
    ),
    FigureTemplate(
        "hyperbola_foci",
        "쌍곡선·초점",
        "S055-P18-F01",
        "수평축 쌍곡선의 두 분리된 가지와 정확한 초점",
        build_hyperbola_foci,
    ),
    FigureTemplate(
        "circle_tangent_chords",
        "원·접선·현",
        "S054-P08-F02",
        "BC=CD인 내접사각형 ABCD와 C에서의 접선 EF",
        build_circle_tangent_chords,
    ),
    FigureTemplate(
        "triangle_equal_segments",
        "정삼각형·변 위의 점",
        "S031-P09-F01",
        "AP+BQ+CR=AB 및 PQ=PR을 보존하는 정삼각형 내부 구성",
        build_triangle_equal_segments,
    ),
    FigureTemplate(
        "circular_seating",
        "원형 좌석 배치",
        "S055-P10-F01",
        "원형 탁자 주위의 등간격 좌석과 좌석 겹침 검증",
        build_circular_seating,
    ),
    FigureTemplate(
        "mapping_diagram",
        "집합·대응 화살표",
        "S028-P02-F01",
        "두 집합과 각 정의역 원소에서 출발하는 한 개의 대응 화살표",
        build_mapping_diagram,
    ),
    FigureTemplate(
        "prism_section",
        "각기둥·절단·분리 배치",
        "S020-P08-F01",
        "고정 투영의 직육면체를 PFGQ 평면으로 절단한 두 각기둥",
        build_prism_section,
    ),
    FigureTemplate(
        "upright_cylinder_oblique_section",
        "원기둥·비스듬한 평면 절단",
        "S005-P02-F01",
        "수직 원기둥의 측면만 통과하는 기울어진 절단 평면과 참 타원 단면",
        build_upright_cylinder_oblique_section,
    ),
    FigureTemplate(
        "mapping_chain",
        "세 집합의 연속 대응",
        "S012-P03-F01",
        "1~6개 원소씩 가진 세 집합 사이의 두 전체 함수와 합성 대응",
        build_mapping_chain,
    ),
    FigureTemplate(
        "cone_inscribed_cylinder",
        "원뿔 안의 동축 원기둥",
        "S009-P03-F01",
        "원뿔 닮음으로 내접 원기둥 반지름을 계산한 고정 투영",
        build_cone_inscribed_cylinder,
    ),
    FigureTemplate(
        "venn_regions",
        "두세 집합의 원자영역",
        "S053-P08-F02",
        "고정된 2·3원 배치의 선택 원자영역 음영; 정본은 회색 면적 스타일의 부분 근거",
        build_venn_regions,
    ),
    FigureTemplate(
        "stacked_cubes",
        "정육면체 층쌓기",
        "S017-P05-F01",
        "정사각·삼각 층의 반복 정육면체와 가려진 모서리를 계산한 고정 투영",
        build_stacked_cubes,
    ),
)


def figure_template_catalog() -> list[dict[str, str]]:
    """Return portable metadata without executable builder references."""
    return [
        {
            "id": item.id,
            "title": item.title,
            "source_id": item.source_id,
            "scope": item.scope,
            "example": f"examples/{item.id}.json",
        }
        for item in FIGURE_TEMPLATES
    ]


def _object(value: object, expected: set[str], member: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise FigureRecipeError(f"{member} must be an object")
    data = cast("dict[object, object]", value)
    if set(data) != expected:
        raise FigureRecipeError(f"{member} requires exactly {sorted(expected)}")
    return cast("dict[str, object]", data)


def expand_figure_template(value: object) -> dict[str, object]:
    """Expand one strict template envelope, preserving only explicit labels.

    The caller must still run the result through ``parse_figure_recipe``. That
    parser validates all expanded primitives and annotation target references.
    Unknown templates and out-of-family parameters fail without substitution.
    """
    envelope = _object(
        value,
        {"schema_version", "template", "visible_annotations"},
        "template construction",
    )
    if envelope["schema_version"] != RECIPE_VERSION:
        raise FigureRecipeError(f"template schema_version must be {RECIPE_VERSION}")
    template = _object(envelope["template"], {"id", "parameters"}, "template")
    identifier = template["id"]
    if not isinstance(identifier, str):
        msg = "template id must be a string"
        raise FigureRecipeError(msg)
    selected = next((item for item in FIGURE_TEMPLATES if item.id == identifier), None)
    if selected is None:
        raise FigureRecipeError(f"unknown figure template: {identifier}")
    parameters = template["parameters"]
    if not isinstance(parameters, dict):
        msg = "template parameters must be an object"
        raise FigureRecipeError(msg)
    annotations = envelope["visible_annotations"]
    if not isinstance(annotations, list):
        msg = "visible_annotations must be an array"
        raise FigureRecipeError(msg)
    expanded = selected.build(cast("dict[str, object]", parameters))
    expanded["label_placement"] = "anchored"
    expanded["visible_annotations"] = list(cast("list[object]", annotations))
    return expanded
