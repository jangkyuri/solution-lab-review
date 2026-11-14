"""Canvas-local mathtext layout matching measured official figure fractions.

HyhwpEQ E06D has a 41/1024-em rule. S029-P03-F01's pi/4 needs about
0.14 em of bar overhang on each side; its denominator clearance is about
0.25 em. These changes belong only to figure canvases, never global parsers.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, ClassVar, Final, cast, override

from matplotlib import _mathtext
from matplotlib.mathtext import MathTextParser, VectorParse

if TYPE_CHECKING:
    _VectorMathParser = MathTextParser[VectorParse]
else:
    _VectorMathParser = MathTextParser

FRACTION_RULE_EM: Final = 41 / 1024
FRACTION_SIDE_PAD_EM: Final = 0.14


class _FigureFontConstants(_mathtext.FontConstantsBase):
    # At the measured HWP glyph x-height, 1.5 gives approximately 0.25 em
    # between the rule and denominator, versus the stock 1.3's short gap.
    denom1: ClassVar[float] = 1.5


class _FigureUnicodeFonts(_mathtext.UnicodeFonts):
    @override
    def get_underline_thickness(self, font: str, fontsize: float, dpi: float) -> float:
        del font
        return FRACTION_RULE_EM * fontsize * dpi / 72

    @override
    def get_font_constants(self) -> type[_mathtext.FontConstantsBase]:
        return _FigureFontConstants


class _FigureParser(_mathtext.Parser):
    @override
    def _genfrac(
        self,
        ldelim: str,
        rdelim: str,
        rule: float | None,
        style: _mathtext.Parser._MathStyle,
        num: _mathtext.Hlist,
        den: _mathtext.Hlist,
    ) -> object:
        if rule:
            state = self.get_state()
            padding = FRACTION_SIDE_PAD_EM * state.fontsize * state.dpi / 72
            num = _mathtext.Hlist(
                [_mathtext.Hbox(padding), num, _mathtext.Hbox(padding)]
            )
            den = _mathtext.Hlist(
                [_mathtext.Hbox(padding), den, _mathtext.Hbox(padding)]
            )
        return cast("object", super()._genfrac(ldelim, rdelim, rule, style, num, den))


class FigureMathTextParser(_VectorMathParser):
    """Independent parser whose rules and fraction spacing apply to one canvas."""

    # MathTextParser's implementation uses these private extension points.
    # A dedicated mapping/parser instance avoids changing Matplotlib globals.
    _font_type_mapping: ClassVar[dict[str, type[_mathtext.TruetypeFonts]]] = {
        "cm": _mathtext.BakomaFonts,
        "dejavuserif": _mathtext.DejaVuSerifFonts,
        "dejavusans": _mathtext.DejaVuSansFonts,
        "stix": _mathtext.StixFonts,
        "stixsans": _mathtext.StixSansFonts,
        "custom": _FigureUnicodeFonts,
    }

    def __init__(self) -> None:
        """Create the vector parser and its independent equation layout state."""
        super().__init__("path")
        self._parser: _mathtext.Parser = _FigureParser()
