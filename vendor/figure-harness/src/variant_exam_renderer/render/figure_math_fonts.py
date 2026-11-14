"""Use locally installed HWP glyphs through Unicode mathtext font mappings.

Official S010-P08 and S082-P05 labels use HyhwpEQ's private-use math
alphabet. Merely choosing that family uses its different ASCII alphabet.
The cache changes cmap/name tables only: all outlines and metrics stay intact.
No font binary is distributed, and no embedded PDF font is extracted.
"""

from __future__ import annotations

import hashlib
import os
import re
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Final, Protocol, cast

from fontTools.ttLib import TTFont  # pyright: ignore[reportMissingTypeStubs]
from matplotlib import font_manager
from matplotlib.typing import RcKeyType

MAPPING_VERSION: Final = "hwp-unicode-v1"
SOURCE_FONT_FILENAME: Final = "HYHWPEQ.TTF"

# These slots were read from the installed font's glyph sheet and confirmed
# against PDF text: E0FC=x, E0FD=y, E0EA=f, E034=1, E035=2, E046=-,
# E047== and E048=+. Digit zero follows nine; it is not before one.
_COMMON_MAP: Final[dict[int, int]] = {
    **{ord(str(digit)): 0xE033 + digit for digit in range(1, 10)},
    ord("0"): 0xE03D,
    **{
        ord(char): slot
        for char, slot in {
            "(": 0xE044,
            ")": 0xE045,
            "-": 0xE046,
            "\u2212": 0xE046,
            "=": 0xE047,
            "+": 0xE048,
            "[": 0xE049,
            "]": 0xE04A,
            "{": 0xE04B,
            "}": 0xE04C,
            "|": 0xE04D,
            ";": 0xE04E,
            ":": 0xE04F,
            ",": 0xE052,
            ".": 0xE053,
            "/": 0xE054,
            "<": 0xE055,
            ">": 0xE056,
            "√": 0xE05C,
            "\u2032": 0xE05D,
            "∑": 0xE067,
            "∫": 0xE072,
        }.items()
    },
    **{
        ord(char): 0xE09D + index
        for index, char in enumerate("αβγδεζηθικλμνξοπρστυφχψω")
    },
}


class _CmapTable(Protocol):
    cmap: dict[int, str]

    def isUnicode(self) -> bool: ...  # noqa: N802


class _Cmap(Protocol):
    tables: list[_CmapTable]


class _NameRecord(Protocol):
    nameID: int  # noqa: N815
    platformID: int  # noqa: N815
    platEncID: int  # noqa: N815
    langID: int  # noqa: N815


class _Names(Protocol):
    names: list[_NameRecord]

    def setName(  # noqa: N802
        self,
        string: str,
        name_id: int,
        platform_id: int,
        encoding_id: int,
        language_id: int,
    ) -> None: ...


class _Font(Protocol):
    def __getitem__(self, key: str) -> object: ...

    def getBestCmap(self) -> dict[int, str]: ...  # noqa: N802

    def save(self, path: str) -> None: ...

    def close(self) -> None: ...


@dataclass(frozen=True)
class FigureMathFonts:
    """Registered local font copies and the source content identity."""

    roman_family: str
    italic_family: str
    roman_path: Path
    italic_path: Path
    source_sha256: str


def source_glyph_map(*, italic: bool) -> dict[int, int]:
    """Return only visually identified HWP slots; uppercase names stay upright."""
    return {
        **_COMMON_MAP,
        **{ord("a") + i: (0xE0E5 if italic else 0xE01A) + i for i in range(26)},
    }


def _source_font() -> Path:
    override = os.environ.get("VARIANT_EXAM_HWP_FONT")
    if override:
        path = Path(override)
    else:
        path = (
            Path(os.environ.get("WINDIR", "C:/Windows"))
            / "Fonts"
            / SOURCE_FONT_FILENAME
        )
    if not path.is_file():
        raise FileNotFoundError(
            f"The graph renderer requires locally installed HyhwpEQ: {path}. VARIANT_EXAM_HWP_FONT may name its existing TTF file."
        )
    return path


def _cache_root() -> Path:
    root = os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_CACHE_HOME")
    return (
        (Path(root) if root else Path.home() / ".cache")
        / "variant-exam-renderer"
        / "fonts"
    )


def _write_mapped_font(
    source: Path, target: Path, family: str, *, italic: bool
) -> None:
    constructor = cast("Callable[[str], _Font]", TTFont)
    font = constructor(str(source))
    try:
        source_map = font.getBestCmap()
        mapping = source_glyph_map(italic=italic)
        missing = set(mapping.values()) - source_map.keys()
        if missing:
            raise ValueError(
                f"The HWP font lacks required source glyph slots: {sorted(missing)}"
            )
        for table in cast("_Cmap", font["cmap"]).tables:
            if table.isUnicode():
                table.cmap.update(
                    {code: source_map[slot] for code, slot in mapping.items()}
                )
        names = cast("_Names", font["name"])
        replacements = {
            1: family,
            2: "Regular",
            4: family,
            6: family.replace(" ", ""),
            16: family,
            17: "Regular",
        }
        for record in list(names.names):
            if record.nameID in replacements:
                names.setName(
                    replacements[record.nameID],
                    record.nameID,
                    record.platformID,
                    record.platEncID,
                    record.langID,
                )
        with NamedTemporaryFile(
            dir=target.parent, suffix=".ttf", delete=False
        ) as temporary:
            temporary_path = Path(temporary.name)
        try:
            font.save(str(temporary_path))
            _ = temporary_path.replace(target)
        finally:
            temporary_path.unlink(missing_ok=True)
    finally:
        font.close()


@lru_cache(maxsize=4)
def _prepare_fonts(source: Path, source_hash: str, cache_root: Path) -> FigureMathFonts:
    identity = hashlib.sha256(
        f"{MAPPING_VERSION}:{source_hash}:{cache_root.resolve()}".encode()
    ).hexdigest()[:16]
    directory = cache_root / identity
    directory.mkdir(parents=True, exist_ok=True)
    paths = (directory / "roman.ttf", directory / "italic.ttf")
    families = (f"VariantExam Hwp Roman {identity}", f"VariantExam Hwp Math {identity}")
    for path, family, italic in zip(paths, families, (False, True), strict=True):
        if not path.is_file():
            _write_mapped_font(source, path, family, italic=italic)
        font_manager.fontManager.addfont(str(path))  # pyright: ignore[reportUnknownMemberType]
    return FigureMathFonts(*families, *paths, source_hash)


def prepare_figure_math_fonts(
    *,
    source: Path | None = None,
    cache_root: Path | None = None,
) -> FigureMathFonts:
    """Build/register content-addressed cmap copies of the installed source font."""
    source_path = (source or _source_font()).resolve()
    source_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
    return _prepare_fonts(source_path, source_hash, cache_root or _cache_root())


def figure_math_rc() -> dict[RcKeyType, object]:
    """Return renderer rc settings, with explicit STIX fallback for other glyphs.

    Unmapped symbols retain the installed font's native Unicode entries. Missing
    symbols and stretch alternatives use STIX; this does not claim complete HWP
    equation-layout equivalence. Fractions and superscripts remain mathtext layout.
    """
    fonts = prepare_figure_math_fonts()
    return {
        "font.family": "serif",
        "font.serif": [fonts.roman_family],
        "mathtext.fontset": "custom",
        "mathtext.rm": fonts.roman_family,
        "mathtext.it": fonts.italic_family,
        "mathtext.fallback": "stix",
        "mathtext.cal": "STIXGeneral:style=italic",
        "mathtext.bf": "STIXGeneral:weight=bold",
        "mathtext.bfit": "STIXGeneral:style=italic:weight=bold",
        "mathtext.sf": "STIXGeneral",
        "mathtext.tt": "STIXGeneral",
    }


def _group_end(text: str, start: int) -> int:
    depth = 0
    index = start
    while index < len(text):
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index + 1
        index += 1
    return len(text)


def _math_argument(text: str, start: int) -> tuple[str, int]:
    index = start
    while index < len(text) and text[index].isspace():
        index += 1
    if index == len(text):
        return text[start:], index
    unit, end = _math_unit(text, index, reduced=True)
    # A bare script command can own a braced argument, e.g. x^\mathrm{...}.
    # Keep such descendants reduced rather than promoting a fraction inside it.
    if text[index] == "\\":
        while end < len(text) and text[end] == "{":
            following, end = _math_unit(text, end, reduced=True)
            unit += following
    return text[start:index] + unit, end


def _math_unit(text: str, start: int, *, reduced: bool) -> tuple[str, int]:
    char = text[start]
    if char == "{":
        end = _group_end(text, start)
        if text[end - 1] != "}":
            return text[start:end], end
        return "{" + _fraction_fragment(
            text[start + 1 : end - 1], reduced=reduced
        ) + "}", end
    if char in "^_":
        argument, end = _math_argument(text, start + 1)
        return char + argument, end
    if char != "\\":
        return char, start + 1
    match = re.match(r"\\(?:[A-Za-z]+|.)", text[start:])
    if match is None:
        return char, start + 1
    command = match.group()
    end = start + len(command)
    if command not in (r"\frac", r"\dfrac", r"\tfrac"):
        return command, end
    output = r"\dfrac" if command == r"\frac" and not reduced else command
    for _ in range(2):
        argument, end = _math_argument(text, end)
        output += argument
    return output, end


def _fraction_fragment(text: str, *, reduced: bool = False) -> str:
    output: list[str] = []
    index = 0
    while index < len(text):
        unit, index = _math_unit(text, index, reduced=reduced)
        output.append(unit)
    return "".join(output)


def normalize_figure_fractions(text: str) -> str:
    r"""Keep top-level figure \frac glyphs at the label's physical font size.

    S029's pi/4 has full-size numerator and denominator. Mathtext's \dfrac
    reproduces that sizing. Fraction arguments and scripts retain their normal
    nested sizes. Only dollar-delimited figure math is changed; prose is intact.
    """
    return _normalize_math_fragments(text, _fraction_fragment)


def normalize_figure_math_aliases(text: str) -> str:
    r"""Project TeX relation synonyms onto MathText's supported spellings.

    This changes only dollar-delimited display text, never recipe data. Complete
    control words are matched so commands such as \left and \nearrow stay intact.
    """
    aliases = {r"\le": r"\leq", r"\ge": r"\geq", r"\ne": r"\neq"}

    def fragment(value: str) -> str:
        return re.sub(
            r"\\(?:[A-Za-z]+|.)",
            lambda match: aliases.get(match.group(), match.group()),
            value,
        )

    return _normalize_math_fragments(text, fragment)


def _normalize_math_fragments(text: str, normalize: Callable[[str], str]) -> str:
    output: list[str] = []
    start = 0
    index = 0
    in_math = False
    while index < len(text):
        if text[index] == "\\":
            index += 2
            continue
        if text[index] == "$":
            fragment = text[start:index]
            output.append(normalize(fragment) if in_math else fragment)
            output.append("$")
            in_math = not in_math
            start = index + 1
        index += 1
    output.append(text[start:])
    return "".join(output)
