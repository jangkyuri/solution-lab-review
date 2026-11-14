import type { Job, OriginalProblem } from '../shared/contracts.ts';
import { isSingleQuestionSource } from './pdf-originals.ts';
import type { PdfAsset } from './pdf-template.ts';

export const STACKED_REFERENCE_PREAMBLE = String.raw`
\newcommand{\baeksinsourcepanels}[2]{%
  \noindent\begin{minipage}[t]{.485\linewidth}\vspace{0pt}\centering #1\end{minipage}\hfill%
  \begin{minipage}[t]{.485\linewidth}\vspace{0pt}\centering #2\end{minipage}\par%
}
\newcommand{\baeksinstackedsource}[2]{%
  \clearpage\restoregeometry\baeksinrunning{}%
  \if\relax\detokenize{#1}\relax\else
    {\labeltext\bfseries\color{ink}\fontsize{16bp}{20bp}\selectfont #1.}\par\vspace{7bp}%
  \fi
  #2\par\vspace{8bp}%
}
\newenvironment{baeksinhandreference}[1]{%
  \begin{tcolorbox}[enhanced jigsaw,breakable,colback=white,colframe=rulegray,
    boxrule=.45bp,arc=4bp,boxsep=0bp,left=8bp,right=8bp,top=7bp,bottom=7bp,
    before skip=0bp,after skip=0bp,colbacktitle=white,coltitle=baeksinolive,
    titlerule=0bp,toptitle=3bp,bottomtitle=7bp,
    fonttitle=\labeltext\bfseries\fontsize{10bp}{12bp}\selectfont,
    title={#1},title after break={#1},pad at break*=5bp,
    lines before break=3]
}{\end{tcolorbox}}
\newcommand{\baeksinfinalsource}[2]{%
  \clearpage\restoregeometry\fancyhf{}\renewcommand{\headrulewidth}{0pt}%
  \baeksinfolio\fancyfoot[R]{\baeksinlabel{\thepage}\hspace{9bp}}\pagestyle{fancy}%
  \begingroup\parskip=0pt%
    \vbox to 17.4bp{%
      \if\relax\detokenize{#1}\relax\else
        \noindent\hspace{9bp}{\labeltext\bfseries\color{ink}\fontsize{15.3bp}{16bp}\selectfont #1.}\par%
      \fi\vfil}%
    \nointerlineskip#2\par%
  \endgroup\vspace{8bp}%
}
\newenvironment{baeksinfinalreference}[1]{%
  \begin{tcolorbox}[enhanced,breakable,colback=white,colframe=rulegray,
    boxrule=.45bp,arc=4bp,boxsep=0bp,left=8.55bp,right=8.55bp,top=5bp,bottom=7bp,
    before skip=0bp,after skip=0bp,colbacktitle=white,coltitle=baeksinolive,
    titlerule=0bp,toptitle=3bp,bottomtitle=5bp,
    fonttitle=\labeltext\bfseries\fontsize{10bp}{12bp}\selectfont,
    title={#1},title after break={#1},pad at break*=5bp,lines before break=3]
}{\end{tcolorbox}}
\newcommand{\baeksinfinalmark}[1]{\baeksinmarkertext{#1}\hspace{7bp}}
`;

export function sourcePanelsTex(upper: string, lower: string): string {
  return String.raw`\baeksinsourcepanels{${upper}}{${lower}}`;
}

export function mappedSourcePanelsTex(original: OriginalProblem, asset: PdfAsset): string | undefined {
  const split = asset.mappedSourceSplits?.get(original.questionNumber);
  if (!split) return undefined;
  const [left, bottom, right, top] = original.trim;
  const width = Math.min(original.widthBp, 265 * split.ratio).toFixed(2);
  const panel = (lower: number, upper: number) => String.raw`\includegraphics[page=${original.page},pagebox=cropbox,trim=${left}bp ${lower}bp ${right}bp ${upper}bp,clip,width=\dimexpr\ifdim${width}bp>\linewidth\linewidth\else${width}bp\fi\relax]{${asset.localName}}`;
  return sourcePanelsTex(panel(split.pageHeight - split.seam, top), panel(bottom, split.seam));
}

/** Only a single-question source and a single combined raster establish an image-to-question pairing. */
export function stackedSourceTex(job: Job, assets: readonly PdfAsset[], finalReference = false): string | null {
  if (!isSingleQuestionSource(job) || assets.length !== 1 || job.originalProblems?.length) return null;
  const [asset] = assets;
  if (!asset?.mimeType.startsWith('image/')) return null;
  if (job.mode === 'supplement' && asset.role !== 'exam_and_handwriting') return null;
  if (asset.sourcePanels) {
    const [upperName, lowerName] = asset.sourcePanels;
    const width = asset.sourcePanelMaxWidthBp?.toFixed(2) ?? '265';
    const panel = (name: string) => String.raw`\includegraphics[width=\dimexpr\ifdim${width}bp>\linewidth\linewidth\else${width}bp\fi\relax]{${name}}`;
    return sourcePanelsTex(panel(upperName), panel(lowerName));
  }
  const aspect = asset.imageSize ? asset.imageSize.width / asset.imageSize.height : null;
  const height = aspect !== null && aspect > 1.7 ? '.42\\textheight' : '.48\\textheight';
  const width = finalReference ? String.raw`\dimexpr\linewidth-18bp\relax` : String.raw`\linewidth`;
  return String.raw`\noindent\makebox[\linewidth][c]{\includegraphics[width=${width},height=${height},keepaspectratio]{${asset.localName}}}`;
}
