import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResultSchema } from '../shared/contracts';
import { ResultEditor } from './components/ResultEditor';
import { editBookletStep, editStep } from './result-edit';

describe('review editing', () => {
  it('preserves original links and handwriting when an explanation is corrected', () => {
    // Given: a step with two observed predecessors and its own source text.
    const result = ResultSchema.parse({ summary: '', references: [], limitations: [], questions: [{
      number: '1', problemText: '', firstDecision: '', variables: ['t'], observedOrder: [], answer: '', uncertainties: [],
      checks: { math: [], sequence: [], graph: [] }, steps: [{ id: 'P04-S03', after: ['P04-S01', 'P04-S02'], branch: 'main_join',
        title: '합류', explanation: '기존 설명', latex: 't=1', originalStep: '원래 필기', evidence: '원본 조건', graph: null }],
    }] });
    // When: the teacher corrects only the explanation.
    const edited = editStep(result, 0, 0, 'explanation', '고친 이유');
    // Then: original provenance and branching remain intact.
    expect(edited.questions[0]?.steps[0]).toMatchObject({ explanation: '고친 이유', originalStep: '원래 필기', after: ['P04-S01', 'P04-S02'], branch: 'main_join' });
    expect(result.questions[0]?.steps[0]?.explanation).toBe('기존 설명');
  });

  it('allows correction of an unflagged source reading only in handwriting mode', () => {
    const result = ResultSchema.parse({ summary: '', references: [], limitations: [], questions: [{
      number: '1', problemText: '', firstDecision: '', variables: ['x'], observedOrder: [], answer: '', uncertainties: [],
      checks: { math: [], sequence: [], graph: [] }, steps: [{
        title: '약분', explanation: '계산을 확인합니다.', latex: 'x=2', originalStep: 'x=2', evidence: '', graph: null,
      }],
    }] });
    const onChange = (): void => undefined;
    const supplement = renderToStaticMarkup(createElement(ResultEditor, { result, onChange, supplement: true }));
    const solve = renderToStaticMarkup(createElement(ResultEditor, { result, onChange, supplement: false }));

    expect(supplement).toContain('name="original-step-0-0"');
    expect(solve).not.toContain('name="original-step-0-0"');
  });

  it('provides student PDF design fields only for handwriting supplementation', () => {
    const result = ResultSchema.parse({ summary: '', references: [], limitations: [], questions: [{
      number: '1', problemText: '', firstDecision: '', variables: ['x'], observedOrder: [], answer: '', uncertainties: [],
      checks: { math: [], sequence: [], graph: [] }, steps: [{
        title: '부호 판단', explanation: '계산을 확인합니다.', latex: 'x=2', originalStep: 'x=2', evidence: '', graph: null,
        booklet: { group: 'B', referenceTip: '극한과 함수값을 구별합니다.', figure: 'wide' },
      }],
    }] });
    const onChange = (): void => undefined;
    const supplement = renderToStaticMarkup(createElement(ResultEditor, { result, onChange, supplement: true }));
    const solve = renderToStaticMarkup(createElement(ResultEditor, { result, onChange, supplement: false }));

    expect(supplement).toContain('<summary>학생용 PDF 디자인</summary>');
    expect(supplement).toContain('value="B" selected=""');
    expect(supplement).toContain('name="booklet-reference-0-0"');
    expect(supplement).toContain('극한과 함수값을 구별합니다.');
    expect(supplement).toContain('value="wide" selected=""');
    expect(solve).not.toContain('name="booklet-reference-0-0"');
  });

  it('clears a reference tip without removing other step design details', () => {
    const booklet = {
      group: 'A', figure: 'side', referenceTip: '이전 참고 팁',
      termNotes: [{ term: 'f(a)', note: '함숫값', color: 'blue' }],
      zoom: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }, zoomNote: '확대할 구간',
      table: [['항목', '조건']],
    };
    const result = ResultSchema.parse({ summary: '', references: [], limitations: [], questions: [{
      number: '1', problemText: '', firstDecision: '', variables: ['x'], observedOrder: [], answer: '', uncertainties: [],
      checks: { math: [], sequence: [], graph: [] }, steps: [{
        title: '부호 판단', explanation: '계산을 확인합니다.', latex: 'x=2', originalStep: 'x=2', evidence: '', graph: null, booklet,
      }],
    }] });
    const edited = editBookletStep(result, 0, 0, 'referenceTip', undefined);

    expect(ResultSchema.parse(edited).questions[0]?.steps[0]?.booklet).toMatchObject({ ...booklet, referenceTip: undefined });
    expect(result.questions[0]?.steps[0]?.booklet?.referenceTip).toBe('이전 참고 팁');
  });
});
