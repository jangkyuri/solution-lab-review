import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResultSchema } from '../../shared/contracts';
import { ResultDocument } from './ResultDocument';

describe('student hand solution preview', () => {
  const result = ResultSchema.parse({ productionVersion: 'hand-solution-v1', summary: '교사 메모', limitations: ['검토 전 초안입니다.'], references: [], questions: [{
      number: '4', problemText: '함숫값을 구하여라.', firstDecision: '조건을 함수에 대입한다.', answer: String.raw`\frac{3}{2}`,
      variables: ['x'], observedOrder: ['원래 흐름'], uncertainties: ['분모가 흐리다.'], checks: { math: ['검토 기록'], sequence: [], graph: [] },
      steps: [{ id: 'S01', title: '함숫값 계산', explanation: '먼저 값을 대입한다.', latex: 'f(1)=2', originalStep: '원문 전사',
        evidence: '교사 판단 근거', graph: null, sourceConflict: '[확인 필요] 분모가 흐리다.',
        booklet: { table: [['조건', '결과'], ['첫째 조건', '함숫값']] } }],
  }] });

  it('shows the answer in its own footer after the solution', () => {
    const html = renderToStaticMarkup(<ResultDocument result={result} supplement />);

    expect(html).toMatch(/문제 4[\s\S]*핵심:[\s\S]*1단계\.[\s\S]*<\/section><footer class="answer-block"><p><strong>정답<\/strong>[\s\S]*class="katex"[\s\S]*<\/footer>[\s\S]*\[확인 필요\]/u);
    expect(html).toMatch(/1단계\.[\s\S]*<th scope="col">조건<\/th>[\s\S]*먼저 값을 대입한다\./u);
    expect(html.match(/\[확인 필요\]/gu)).toHaveLength(1);
    expect(html).not.toContain('원문 전사');
  });

  it('uses square brackets for evaluation in the solution and preserves the original problem notation', () => {
    const previousNotation = String.raw`\left.F(x)\right|_{0}^{1}`;
    const bracketNotation = String.raw`\left[F(x)\right]_{0}^{1}`;
    const view = ResultSchema.parse({ ...result, questions: [{ ...result.questions[0],
      problemText: `\\(${previousNotation}\\)의 값을 구하여라.`,
      steps: [{ ...result.questions[0]?.steps[0], latex: `${previousNotation}=2`,
        explanation: `\\(${previousNotation}\\)의 값을 계산한다.` }],
    }] });
    const html = renderToStaticMarkup(<ResultDocument result={view} supplement />);

    expect(html.split(previousNotation)).toHaveLength(2);
    expect(html.split(bracketNotation)).toHaveLength(3);
  });

  it.each(['hand-solution-v1', undefined])('loads recipe figures using the saved question and step indexes for format %s', (productionVersion) => {
    const firstQuestion = result.questions[0]!;
    const firstStep = firstQuestion.steps[0]!;
    const figureRecipe = JSON.stringify({ version: 'figure_recipe_v1' });
    const view = ResultSchema.parse({ ...result, productionVersion, questions: [{ ...firstQuestion, steps: [
      { ...firstStep, id: 'empty', explanation: '', latex: '', booklet: undefined },
      { ...firstStep, title: '접점과 x축', explanation: '', latex: '', booklet: undefined, figureRecipe },
    ] }] });
    const html = renderToStaticMarkup(<ResultDocument result={view} supplement
      figureSource={{ jobId: 'saved job', version: '2026-11-13T12:00:00Z', questionOffset: 4, revisionId: 'history' }} />);

    expect(html).toContain('<img src="/api/jobs/saved%20job/figures/4/1?v=2026-11-13T12%3A00%3A00Z&amp;revision=history" alt="접점과 x축" loading="lazy"/>');
    expect(html).not.toContain(figureRecipe);
  });

  it.each(['hand-solution-v1', undefined])('omits review and audit material for format %s', (productionVersion) => {
    const view = ResultSchema.parse({ ...result, productionVersion });
    const html = renderToStaticMarkup(<ResultDocument result={view} supplement onOpenSource={() => {}} />);

    expect(html).toContain('먼저 값을 대입한다.');
    expect(html).toMatch(/<\/section><footer class="answer-block"><p><strong>정답<\/strong>/u);
    expect(html).toContain('분모가 흐리다.');
    expect(html).toMatch(/<button [^>]*>[^<]*(?:첨부 원본 보기|올린 손풀이 보기)<\/button>/u);
    expect(html).not.toMatch(/교사 검토 자료|결과 검토 메모|검산과 풀이 순서 확인|사용한 미지수|교사 메모|검토 전 초안|원래 흐름|S01|교사 판단 근거|검토 기록/u);
  });

  it.each(['hand-solution-v1', undefined])('shows the cost for the matching question in format %s', (productionVersion) => {
    const view = ResultSchema.parse({ ...result, productionVersion });
    const html = renderToStaticMarkup(<ResultDocument result={view} supplement questionApiCosts={{
      '4': { requests: 1, inputTokens: 20, cachedInputTokens: 0, outputTokens: 10, estimatedUsd: 0.0123, status: 'estimated' },
      '5': { requests: 2, inputTokens: 40, cachedInputTokens: 0, outputTokens: 30, estimatedUsd: 0.0456, status: 'estimated' },
    }} />);

    expect(html).toMatch(/<h2>[^<]*4[^<]*<\/h2>[\s\S]*?문항 API 비용[\s\S]*?\$0\.0123/u);
    expect(html).not.toContain('$0.0456');
  });
});
