import { describe, expect, it } from 'vitest';
import { normalizeKnowledge } from './knowledge-normalize.ts';

const originalPath = '수학_손풀이_학습/확대01/분리기록/원본핵심_Q01-05.json';
const supplementPath = '수학_손풀이_학습/확대01/분리기록/보충필요_Q01-05.json';
const original = {
  track: 'original_core', problems: [{
    sampleId: 'M1B01-Q01', sourceId: 'expansion-source', centralArgument: '같은 가로좌표의 연결',
    steps: [
      { stepId: 'M1B01-Q01-S01', sourceEvidence: '첫 단계', mathematicalContent: 'a=1', role: '조건', after: [] },
      { stepId: 'M1B01-Q01-S02', sourceEvidence: '둘째 단계', mathematicalContent: 'b=2', role: '독립 조건', after: [] },
      { stepId: 'M1B01-Q01-S03', sourceEvidence: '합류', mathematicalContent: 'a+b=3', role: '합류', after: ['M1B01-Q01-S01', 'M1B01-Q01-S02'] },
    ],
    graphEquationLinks: [
      { stepIds: ['M1B01-Q01-S01', 'M1B01-Q01-S02', 'M1B01-Q01-S03'], sourceEvidence: '여러 단계의 대응', role: '계산식 연결' },
      { fromStep: 'M1B01-Q01-S01', toStep: 'M1B01-Q01-S02', sourceEvidence: '두 식의 대응' },
      { steps: ['M1B01-Q01-S01', 'M1B01-Q01-S03'], observation: '같은 표시' },
      { fromStep: 'M1B01-Q01-S02', toStep: 'M1B01-Q01-S03', sourceObservation: '같은 가로좌표' },
    ],
    preserve: ['a,b'], sourceIssueRefs: [],
  }],
};
const supplement = { track: 'supplement_needs', problems: [{ sampleId: 'M1B01-Q01', items: [], needsUserInput: [] }] };

function documents(core: unknown = original) {
  return [
    { path: originalPath, value: core },
    { path: supplementPath, value: supplement },
    { path: '수학_손풀이_학습/검증문항/V01_원본핵심.json', value: { track: 'original_core', problems: [{ sampleId: 'V01' }] } },
  ];
}

describe('expansion knowledge adapter', () => {
  it('imports the published expansion paths and all four observed graph-link shapes without linearizing groups', () => {
    const [problem] = normalizeKnowledge(documents());
    expect(problem?.sampleId).toBe('M1B01-Q01');
    expect(problem?.steps.map((step) => step.after)).toEqual([[], [], ['M1B01-Q01-S01', 'M1B01-Q01-S02']]);
    expect(problem?.graphEquationLinks).toHaveLength(4);
    expect(problem?.graphEquationLinks[0]).toMatchObject({ fromStep: null, toStep: null, atStep: null, raw: original.problems[0]?.graphEquationLinks[0] });
    expect(problem?.graphEquationLinks.map((link) => link.description)).toEqual([
      '관련 단계: M1B01-Q01-S01, M1B01-Q01-S02, M1B01-Q01-S03\n여러 단계의 대응\n계산식 연결',
      '두 식의 대응',
      '관련 단계: M1B01-Q01-S01, M1B01-Q01-S03\n같은 표시',
      '같은 가로좌표',
    ]);
  });

  it.each([
    { fromStep: 'M1B01-Q01-S01', toStep: 'M1B01-Q01-S03', sourceEvidence: '정상 양끝', stepIds: ['M1B01-Q01-S01', 'M1B01-Q02-S02'] },
    { fromStep: 'M1B01-Q01-S01', toStep: 'M1B01-Q01-S03', sourceEvidence: '정상 양끝', steps: ['M1B01-Q02-S02'], observation: '외부 단계' },
    { stepIds: ['M1B01-Q01-S01'], sourceEvidence: '그룹 하나', role: '연결', steps: ['M1B01-Q02-S02'], observation: '다른 그룹' },
    { atStep: 'M1B01-Q01-S01', from: '점', to: '식', mark: '대응', fromStep: 'M1B01-Q02-S02', toStep: 'M1B01-Q01-S03', sourceEvidence: '혼합 끝점' },
  ])('rejects mixed reference shapes rather than hiding unselected reference fields', (link) => {
    const changed = { ...original, problems: original.problems.map((problem) => ({ ...problem, graphEquationLinks: [link] })) };
    expect(() => normalizeKnowledge(documents(changed))).toThrow('그래프 연결에 서로 다른 참조 형식을 섞을 수 없습니다.');
  });

  it('checks every grouped link reference including an intermediate step', () => {
    const changed = { ...original, problems: original.problems.map((problem) => ({
      ...problem, graphEquationLinks: [{ stepIds: ['M1B01-Q01-S01', 'M1B01-Q02-S02', 'M1B01-Q01-S03'], sourceEvidence: '잘못 연결된 중간 단계', role: '계산식 연결' }],
    })) };
    expect(() => normalizeKnowledge(documents(changed))).toThrow('그래프와 식의 단계 참조가 끊어졌습니다.');
  });
});
