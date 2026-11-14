import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { JobSchema } from '../shared/contracts.ts';
import { HAND_SOLUTION_PRODUCTION_VERSION } from '../shared/hand-solution-output.ts';
import { jobFixture } from './generation-fixtures.ts';
import { compilePdf } from './pdf-runtime.ts';
import { renderPdfTex } from './pdf-template.ts';

function fixture(overflow: boolean) {
  return JobSchema.parse({ ...jobFixture, status: 'ready', result: {
    productionVersion: HAND_SOLUTION_PRODUCTION_VERSION, summary: '', references: [], limitations: [],
    questions: [1, 2, 3, 4].map(number => ({ number: String(number), problemText: `다음 함수의 값을 구하여라.`,
      firstDecision: '주어진 값을 함수에 대입한다.', answer: '2', variables: [], observedOrder: [], uncertainties: [],
      checks: { math: [], sequence: [], graph: [] },
      steps: [{ title: '함숫값 구하기', explanation: overflow && number === 1
        ? `${'식을 정리하면 함숫값을 확인할 수 있다.\n'.repeat(95)}계산 마침` : '함숫값을 계산한다.',
      latex: 'f(1)=2', originalStep: '', evidence: '', graph: null }],
    })),
  } });
}

it.each([false, true])('pairs four v1 questions in order with continuation when necessary (long=%s)', async overflow => {
  const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-paired-pdf-'));
  try {
    await mkdir(path.join(directory, 'build'));
    let tex = renderPdfTex(fixture(overflow), [], new Map(), 'review');
    tex = tex.replace(String.raw`\begin{document}`, String.raw`\begin{document}
\newwrite\pairpositions\immediate\openout\pairpositions=pair-positions.txt
\newcommand{\pairposition}[1]{\leavevmode\pdfsavepos\write\pairpositions{#1:\thepage:\the\pdflastxpos}}`);
    tex = tex.replace(/문제 ([1-4])(?=\})/gu, (_text, number: string) => `\\pairposition{${number}}문제 ${number}`);
    tex = tex.replace('계산 마침', String.raw`\pairposition{tail}계산 마침`);
    tex = tex.replace(String.raw`\end{document}`, String.raw`\clearpage\immediate\closeout\pairpositions\end{document}`);
    await writeFile(path.join(directory, 'main.tex'), tex, 'utf8');

    const pages = await compilePdf(directory);
    const positions = new Map((await readFile(path.join(directory, 'build', 'pair-positions.txt'), 'utf8')).trim().split(/\r?\n/u).map(line => {
      const [label, page, x] = line.split(':');
      return [label, { page: Number(page), x: Number(x) }] as const;
    }));
    expect(positions.get('1')?.page).toBe(1);
    expect(positions.get('2')?.page).toBe(1);
    expect(positions.get('2')?.x).toBeGreaterThan(positions.get('1')?.x ?? 0);
    expect(positions.get('3')?.page).toBe(pages);
    expect(positions.get('4')?.page).toBe(pages);
    if (overflow) {
      expect(positions.get('tail')?.page).toBeGreaterThan(1);
      expect(positions.get('tail')?.page).toBeLessThan(pages);
    } else expect(pages).toBe(2);
  } finally {
    if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('solution-lab-paired-pdf-')) throw new Error('Unexpected test directory');
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);

function mappedFixture() {
  const base = fixture(false);
  const questionNumbers = ['1', '2', '3', '4'];
  const job = JobSchema.parse({ ...base, mode: 'supplement', files: [{ id: 'source', name: '시험지.pdf', mimeType: 'application/pdf',
    role: 'exam', size: 1, url: '/api/files/source' }],
    originalProblems: questionNumbers.map((questionNumber, index) => ({ questionNumber, fileId: 'source', page: index + 1,
      trim: [0, 0, 0, 0], widthBp: 590 })),
  });

  const assets = [{ localName: 'combined.pdf', name: '시험지.pdf', mimeType: 'application/pdf',
    role: 'exam_and_handwriting', sourceFileIds: ['source', 'hand'] }] as const;
  return { job, assets, questionNumbers };
}

it('uses each explicitly mapped combined source page in its column without a second source copy', () => {
  const { job, assets, questionNumbers } = mappedFixture();
  const body = renderPdfTex(job, assets, new Map(), 'review').split(String.raw`\begin{document}`)[1] ?? '';

  expect([...body.matchAll(/\\solutionpairsource\{\\includegraphics\[page=(\d+),[^\]]+\]\{combined\.pdf\}/gu)].map(match => match[1])).toEqual(questionNumbers);
  expect(body).not.toContain(String.raw`\includepdf`);
});

it('exports each mapped source with its own full-width explanation without a second source copy', () => {
  const { job, assets, questionNumbers } = mappedFixture();
  const body = renderPdfTex(job, assets, new Map([['0-0', 'graph.tex']])).split(String.raw`\begin{document}`)[1] ?? '';

  expect(body).not.toContain(String.raw`\solutionpair{`);
  expect([...body.matchAll(/\\baeksinfinalsource\{([1-4])\}/gu)].map(match => match[1])).toEqual(questionNumbers);
  expect([...body.matchAll(/\\includegraphics\[page=(\d+),[^\]]+\]\{combined\.pdf\}/gu)].map(match => match[1])).toEqual(questionNumbers);
  expect(body).not.toContain(String.raw`\includepdf`);
  expect(body).toContain('graph.tex');
  expect(body.match(/\\baeksinfinalmark\{A\}/gu)).toHaveLength(4);
  expect(body).toContain(String.raw`\baeksinleftmath{f(1)=2}`);
  expect(body).not.toMatch(/정답:|핵심:|1단계/gu);
});
