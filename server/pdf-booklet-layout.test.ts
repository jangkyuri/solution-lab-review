import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { JobSchema } from '../shared/contracts.ts';
import { BAEKSIN_V16_PDF_DESIGN, LEGACY_PDF_DESIGN } from '../shared/pdf-design.ts';
import { jobFixture } from './generation-fixtures.ts';
import { compilePdf } from './pdf-runtime.ts';
import * as nativeGraph from './pdf-graph-native.ts';
import { buildJobPdf } from './pdf.ts';
import { renderPdfTex } from './pdf-template.ts';

const graph = { title: '', xMin: -2, xMax: 2, yMin: -2, yMax: 2, xLabel: 'x', yLabel: 'y',
  curves: [], points: [{ x: 1, y: 1, label: 'P', open: false }], verticals: [], explanation: '' };
const table = [['관찰 근거', '결과'], ['높이의 부호', '두 경우']];
const graphLinks = [{ anchors: [{ x: 1, y: 1 }], latex: 'f(1)=1', note: '같은 가로좌표의 높이', color: 'blue' }] as const;
function fixture(kind: 'key-table' | 'graph-table' | 'key' = 'key-table', figure: 'side' | 'wide' | 'small' = 'side', linked = false) {
  return JobSchema.parse({ ...jobFixture, mode: 'supplement', status: 'ready', pdfDesign: BAEKSIN_V16_PDF_DESIGN,
    teacherText: '높이의 부호를 먼저 비교한다.', result: { summary: '', references: [], limitations: [], questions: [{
      number: '1', problemText: String.raw`함수 \(f(x)=x^2\)에서 높이의 조건을 비교하여라.`, firstDecision: '', variables: ['x', 'k'], observedOrder: [],
      answer: '2', uncertainties: [], checks: { math: [], sequence: [], graph: [] }, steps: [{
        id: 'S01', after: [], branch: '원래 분기', title: '', originalStep: '', evidence: '', latex: 'k=2',
        explanation: '관찰한 두 경우를 비교하므로 이 조건이 남는다.', graph: kind === 'graph-table' ? graph : null,
        booklet: { group: 'A', equationRole: kind === 'graph-table' ? 'normal' : 'key', figure,
          ...(kind === 'key' ? {} : { table }), ...(linked ? { graphLinks } : {}), takeaway: '이 조건만 남는다.' },
      }],
    }] } });
}
function body(job: ReturnType<typeof fixture>, zoom = false) {
  const assets = new Map<string, string>();
  if (job.result?.questions[0]?.steps[0]?.graph) assets.set('0-0', 'graph-main.tex');
  if (zoom) assets.set('0-0:zoom', 'graph-zoom.tex');
  return renderPdfTex(job, [], assets).split(String.raw`\begin{document}`)[1] ?? '';
}
async function clean(directory: string) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('solution-lab-evidence-')) throw new Error('Unexpected evidence test directory');
  await rm(resolved, { recursive: true, force: true });
}

describe('Baeksin evidence-first step layout', () => {
  it('keeps table evidence before the brief reason, key relation, takeaway and final answer', () => {
    const job = fixture();
    const original = structuredClone(job);
    const tex = body(job);
    const evidence = tex.indexOf('관찰 근거');
    const reason = tex.indexOf('관찰한 두 경우');
    const key = tex.indexOf(String.raw`\baeksinkeymath{`);
    const takeaway = tex.indexOf('이 조건만 남는다.');
    const answer = tex.indexOf(String.raw`\textbf{정답}\enspace 2`);
    expect(evidence).toBeGreaterThanOrEqual(0);
    expect(evidence).toBeLessThan(reason);
    expect(reason).toBeLessThan(key);
    expect(key).toBeLessThan(takeaway);
    expect(takeaway).toBeLessThan(answer);
    expect(tex).toContain(String.raw`\baeksinevidence{`);
    expect(tex.match(/\\textbf\{정답\}\\enspace 2/gu) ?? []).toHaveLength(1);
    expect(job).toStrictEqual(original);
  });

  it.each(['side', 'wide', 'small'] as const)('puts the %s graph before or beside its table and places the judgment afterwards', figure => {
    const job = fixture('graph-table', figure);
    const tex = body(job);
    const reason = tex.indexOf('관찰한 두 경우');
    const visual = tex.indexOf(String.raw`\input{graph-main.tex}`);
    const evidence = tex.indexOf('관찰 근거');
    if (figure === 'wide') expect(visual).toBeLessThan(evidence);
    else {
      const bundle = tex.indexOf(String.raw`\begin{baeksinside}{`);
      expect(bundle).toBeGreaterThanOrEqual(0);
      expect(bundle).toBeLessThan(evidence);
      expect(bundle).toBeLessThan(visual);
    }
    expect(evidence).toBeLessThan(reason);
    expect(visual).toBeLessThan(reason);
    expect(tex.indexOf('k=2')).toBeLessThan(visual);
    expect(tex.indexOf('k=2')).toBeLessThan(evidence);
    expect(tex.indexOf('이 조건만 남는다.')).toBeGreaterThan(visual);
    expect(tex.indexOf(String.raw`\textbf{정답}\enspace 2`)).toBeGreaterThan(visual);
    expect(tex.indexOf(String.raw`\textbf{정답}\enspace 2`)).toBeGreaterThan(evidence);
  });

  it('uses a full-width linked graph panel before its full table even when the old figure setting is side', () => {
    const tex = body(fixture('graph-table', 'side', true));
    expect(tex.indexOf(String.raw`\input{graph-main.tex}`)).toBeLessThan(tex.indexOf('관찰 근거'));
    expect(tex).not.toContain(String.raw`\begin{baeksinside}{`);
    expect(tex.indexOf(String.raw`\textbf{정답}\enspace 2`)).toBeGreaterThan(tex.indexOf('이 조건만 남는다.'));
  });

  it('preserves main and inset order and puts the table, takeaway and answer after the zoom evidence', () => {
    const job = fixture('graph-table');
    const booklet = job.result?.questions[0]?.steps[0]?.booklet;
    if (booklet) { booklet.zoom = { xMin: 0, xMax: 1.5, yMin: 0, yMax: 1.5 }; booklet.zoomNote = '같은 점을 확대한다.'; }
    const tex = body(job, true);
    const main = tex.indexOf(String.raw`\input{graph-main.tex}`);
    const zoom = tex.indexOf(String.raw`\input{graph-zoom.tex}`);
    const evidence = tex.indexOf('관찰 근거');
    expect(tex).toContain(String.raw`\baeksinzoom{`);
    expect(main).toBeLessThan(zoom);
    expect(zoom).toBeLessThan(evidence);
    expect(tex.indexOf('같은 점을 확대한다.')).toBeLessThan(evidence);
    expect(tex.indexOf(String.raw`\textbf{정답}\enspace 2`)).toBeGreaterThan(evidence);
  });

  it('keeps a given function definition before evidence and preserves legacy key-first steps without evidence', () => {
    const job = fixture();
    const step = job.result?.questions[0]?.steps[0];
    if (step) step.latex = 'f(x)=x^2';
    const tex = body(job);
    expect(tex.indexOf('f(x)=x^2', tex.indexOf(String.raw`\begin{baeksingroup}{A}`))).toBeLessThan(tex.indexOf('관찰 근거'));
    const legacy = body(fixture('key'));
    expect(legacy.indexOf(String.raw`\baeksinkeymath{`)).toBeLessThan(legacy.indexOf('관찰한 두 경우'));
  });

  it('keeps adjacent original steps and branch groups in order', () => {
    const job = fixture();
    const question = job.result?.questions[0];
    const first = question?.steps[0];
    if (!question || !first) throw new Error('Missing step order fixture');
    question.steps.push({ ...first, id: 'S02', after: ['S01'], explanation: '다음 원래 단계를 읽는다.',
      booklet: { ...first.booklet, group: 'A', table: [['다음 단계 근거', '결과'], ['양수', '한 경우']] } });
    question.steps.push({ ...first, id: 'S03', after: ['S02'], branch: '다음 분기', explanation: '다음 분기를 읽는다.', booklet: { ...first.booklet, group: 'B' } });
    const original = structuredClone(job);
    const tex = body(job);
    expect(tex.indexOf('관찰한 두 경우')).toBeLessThan(tex.indexOf('다음 단계 근거'));
    expect(tex.indexOf('다음 원래 단계')).toBeLessThan(tex.indexOf(String.raw`\begin{baeksingroup}{B}`));
    expect(tex.match(/\\textbf\{정답\}\\enspace 2/gu) ?? []).toHaveLength(1);
    expect(job).toStrictEqual(original);
  });

  it('keeps a useful reference next to its graph and before the table/answer, without repeating a graph link note', () => {
    const job = fixture('graph-table', 'wide', true);
    const booklet = job.result?.questions[0]?.steps[0]?.booklet;
    if (booklet) booklet.referenceTip = '접점도 서로 다른 점 하나로 센다.';
    const tex = body(job);
    const visual = tex.indexOf(String.raw`\input{graph-main.tex}`);
    const tip = tex.indexOf('접점도 서로 다른 점 하나로 센다.');
    expect(visual).toBeLessThan(tip);
    expect(tip).toBeLessThan(tex.indexOf('관찰 근거'));
    expect(tip).toBeLessThan(tex.indexOf(String.raw`\textbf{정답}\enspace 2`));
    if (booklet) booklet.referenceTip = graphLinks[0].note;
    expect(body(job)).not.toContain(String.raw`\baeksinreference{`);
  });

  it('leaves the standard template order and source data unchanged', () => {
    const job = JobSchema.parse({ ...fixture('graph-table', 'wide', true), pdfDesign: LEGACY_PDF_DESIGN });
    const original = structuredClone(job);
    const tex = body(job);
    expect(tex).not.toContain(String.raw`\baeksinevidence{`);
    expect(tex.indexOf('관찰한 두 경우')).toBeLessThan(tex.indexOf(String.raw`\includegraphics[width=\linewidth`));
    expect(job).toStrictEqual(original);
  });

  it('keeps the actual group marker on the same page as its fitting evidence unit', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-evidence-'));
    try {
      await mkdir(path.join(directory, 'build'));
      const preamble = renderPdfTex(fixture(), [], new Map()).split(String.raw`\begin{document}`)[0] ?? '';
      const tex = preamble + String.raw`\begin{document}\fontsize{11.2bp}{18.2bp}\selectfont
\newwrite\layoutpages\immediate\openout\layoutpages=layout-pages.txt
\newcommand{\pagemarker}[1]{\leavevmode\write\layoutpages{#1:\thepage}}
\null\vspace*{.75\textheight}\par
\begin{baeksingroup}{\pagemarker{marker}D}
\baeksinevidence{\pagemarker{table}\rule{80bp}{.28\textheight}\par\pagemarker{reason}근거를 읽고 판단한다.\par\pagemarker{answer}정답을 정리한다.\par}
\end{baeksingroup}\clearpage\immediate\closeout\layoutpages\end{document}`;
      await writeFile(path.join(directory, 'main.tex'), tex, 'utf8');
      expect(await compilePdf(directory)).toBe(2);
      const pages = (await readFile(path.join(directory, 'build', 'layout-pages.txt'), 'utf8')).trim().split(/\r?\n/u);
      expect(pages).toEqual(['marker:2', 'table:2', 'reason:2', 'answer:2']);
    } finally { await clean(directory); }
  }, 120_000);

  it.each([false, true])('anchors the real marker above the first graph or equation at the original margin (equation=%s)', async withEquation => {
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-evidence-'));
    try {
      await mkdir(path.join(directory, 'build'));
      const job = fixture('graph-table', 'wide', true);
      const step = job.result?.questions[0]?.steps[0];
      if (!step?.graph) throw new Error('Missing marker-position graph');
      if (!withEquation) step.latex = '';
      let visual = nativeGraph.renderBookletGraphTex(step.graph, { width: 460, graphLinks: step.booklet?.graphLinks ?? [] });
      const height = visual.match(/use as bounding box\] \(0,0\) rectangle \([^,]+,([\d.]+)\)/u)?.[1];
      if (!height) throw new Error('Missing native graph bounds');
      visual = visual.replace('\\end{tikzpicture}', String.raw`\node[inner sep=0pt,outer sep=0pt] at (0,0) {\positionmarker{graph-bottom}};
\node[inner sep=0pt,outer sep=0pt] at (0,` + height + String.raw`) {\positionmarker{graph-top}};
\end{tikzpicture}`);
      await writeFile(path.join(directory, 'graph-main.tex'), visual, 'utf8');
      let tex = renderPdfTex(job, [], new Map([['0-0', 'graph-main.tex']]));
      tex = tex.replace(String.raw`\begin{document}`, String.raw`\begin{document}
\newwrite\layoutpositions\immediate\openout\layoutpositions=layout-positions.txt
\newcommand{\positionmarker}[1]{\leavevmode\pdfsavepos\write\layoutpositions{#1:\thepage:\the\pdflastxpos:\the\pdflastypos}}`);
      tex = tex.replace(String.raw`\begin{baeksingroup}{A}`, String.raw`\begin{baeksingroup}{\positionmarker{marker}A}`);
      tex = tex.replace(String.raw`\[\displaystyle k=2\]`, String.raw`\[\displaystyle \positionmarker{equation}k=2\]`);
      tex = tex.replace(String.raw`\end{document}`, String.raw`\clearpage\immediate\closeout\layoutpositions\end{document}`);
      await writeFile(path.join(directory, 'main.tex'), tex, 'utf8');
      expect(await compilePdf(directory)).toBe(2);
      const lines = (await readFile(path.join(directory, 'build', 'layout-positions.txt'), 'utf8')).trim().split(/\r?\n/u);
      const positions = new Map<string, { page: number; x: number; y: number }>();
      for (const line of lines) {
        const [name, page, x, y] = line.split(':');
        if (!name) throw new Error('Missing position marker name');
        positions.set(name, { page: Number(page), x: Number(x), y: Number(y) });
      }
      const marker = positions.get('marker');
      const graphTop = positions.get('graph-top');
      const graphBottom = positions.get('graph-bottom');
      if (!marker || !graphTop || !graphBottom) throw new Error('Missing marker or graph position');
      expect(lines.filter(line => line.startsWith('marker:'))).toHaveLength(1);
      expect(marker.page).toBe(graphTop.page);
      expect(marker.x / 65781.76).toBeCloseTo(26, 0);
      expect(marker.y).toBeGreaterThan(graphBottom.y);
      expect(marker.y + 12 * 65781.76).toBeGreaterThanOrEqual(graphTop.y);
      if (withEquation) {
        const equation = positions.get('equation');
        if (!equation) throw new Error('Missing first equation position');
        expect(marker.page).toBe(equation.page);
        expect(marker.y).toBeGreaterThan(equation.y);
      }
    } finally { await clean(directory); }
  }, 120_000);

  it('introduces numeric conditions and ordinary calculations before their linked numeric graph', () => {
    const job = fixture('graph-table', 'wide', true);
    const step = job.result?.questions[0]?.steps[0];
    if (step) step.latex = String.raw`k=2,\quad f(x)=|x^3-3x+2|`;
    const tex = body(job);
    expect(tex.indexOf('k=2')).toBeLessThan(tex.indexOf(String.raw`\input{graph-main.tex}`));
    expect(tex.indexOf('f(x)=|x^3-3x+2|')).toBeLessThan(tex.indexOf('관찰 근거'));
  });

  it.each([false, true])('stages graph links at native widths and preserves the plain zoom inset (zoom=%s)', async zoom => {
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-evidence-'));
    const render = vi.spyOn(nativeGraph, 'renderBookletGraphTex');
    try {
      const job = fixture('graph-table', 'side', true);
      const booklet = job.result?.questions[0]?.steps[0]?.booklet;
      if (zoom && booklet) booklet.zoom = { xMin: 0, xMax: 1.5, yMin: 0, yMax: 1.5 };
      const original = structuredClone(job);
      const output = await buildJobPdf(job, [], directory);
      expect((await readFile(output.path)).subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(render.mock.calls[0]?.[1]?.width).toBe(zoom ? 250 : 460);
      expect(render.mock.calls[0]?.[1]?.graphLinks).toEqual(booklet?.graphLinks);
      expect(render.mock.calls).toHaveLength(zoom ? 2 : 1);
      if (zoom) {
        expect(render.mock.calls[1]?.[1]?.width).toBe(175);
        expect(render.mock.calls[1]?.[1]?.graphLinks).toBeUndefined();
      }
      expect(job).toStrictEqual(original);
    } finally { render.mockRestore(); await clean(directory); }
  }, 120_000);

  it.each([false, true])('measures evidence blocks and keeps only one-page blocks indivisible (oversize=%s)', async oversize => {
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-evidence-'));
    try {
      await mkdir(path.join(directory, 'build'));
      const preamble = renderPdfTex(fixture(), [], new Map()).split(String.raw`\begin{document}`)[0] ?? '';
      const marks = oversize
        ? String.raw`\pagemarker{table}\rule{80bp}{.4\textheight}\par\pagemarker{reason}\rule{80bp}{.4\textheight}\par\pagemarker{answer}\rule{80bp}{.4\textheight}\par`
        : String.raw`\pagemarker{table}\rule{80bp}{70bp}\par\vspace{20bp}\pagemarker{reason}근거를 읽고 조건을 판단한다.\par\vspace{20bp}\pagemarker{answer}정답을 정리한다.\par`;
      const preceding = oversize ? '' : String.raw`\null\vspace*{.85\textheight}\par`;
      const tex = preamble + String.raw`\begin{document}\fontsize{11.2bp}{18.2bp}\selectfont
\newwrite\layoutpages\immediate\openout\layoutpages=layout-pages.txt
\newcommand{\pagemarker}[1]{\leavevmode\write\layoutpages{#1:\thepage}}
` + preceding + String.raw`\baeksinevidence{` + marks + String.raw`}\clearpage\immediate\closeout\layoutpages\end{document}`;
      await writeFile(path.join(directory, 'main.tex'), tex, 'utf8');
      expect(await compilePdf(directory)).toBe(2);
      const pages = (await readFile(path.join(directory, 'build', 'layout-pages.txt'), 'utf8')).trim().split(/\r?\n/u);
      if (oversize) { expect(pages[0]).toBe('table:1'); expect(pages.at(-1)).toBe('answer:2'); }
      else expect(pages).toEqual(['table:2', 'reason:2', 'answer:2']);
    } finally { await clean(directory); }
  }, 120_000);
});
