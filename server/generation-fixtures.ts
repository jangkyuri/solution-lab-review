import { JobSchema } from '../shared/contracts.ts';
import type { KnowledgeLibrary, KnowledgeProblem } from '../shared/knowledge.ts';
import type { GeneratedResult, Reading } from './generation-schemas.ts';

export const readingFixture: Reading = {
  coverage: { pageCount: null, detectedQuestionCount: 1, unreadableQuestionNumbers: [], complete: true },
  questions: [{ number: '1', printedNumberPrefix: '1. 함수', problemText: '1. 함수 f(x)=x^2의 도함수를 구하여라.', variables: ['x', 'f'], handwritingStatus: 'read',
    observedSteps: [{ id: 'S01', text: 'f(x+h)-f(x)', after: [], branch: null }], visualObservations: [], retrievalTerms: ['함수', '도함수'], uncertainties: [] }], limitations: [],
};
export const exampleFixture: KnowledgeProblem = {
  sampleId: 'P01', sourceId: 'source-1', title: '함수 도함수', centralArgument: '미분계수 정의',
  steps: [], supplements: [], graphEquationLinks: [], preserve: [], sourceIssueRefs: [], needsUserInput: [], raw: {},
};
export const libraryFixture: KnowledgeLibrary = {
  summary: { snapshotId: 'snapshot-1', capturedAt: '2026-11-06T00:00:00Z', recordCount: 1, problemCount: 1, stepCount: 1, graphLinkCount: 0, supplementCount: 0, sourcePath: 'test-only', teacherApproval: 'not_inferred' },
  problems: [exampleFixture], warning: null,
};
export const jobFixture = JobSchema.parse({
  id: 'job-1', title: '도함수', subject: '미적1', mode: 'solve', status: 'draft', inputText: '함수 f(x)=x^2의 도함수를 구하여라.',
  teacherText: '', instruction: '', reviewNote: '', createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z', files: [], result: null, error: null, model: null,
});
export function generatedFixture(): GeneratedResult {
  return {
    summary: '도함수를 구한다.',
    questions: [{ number: '1', problemText: 'model transcription', firstDecision: '미분계수의 정의를 사용한다.', variables: ['x', 'f'], observedOrder: [],
      steps: [{ id: 'S01', after: [], branch: null, sourceIssueRefs: [], sourceConflict: null, booklet: null, title: '차분', explanation: '차분을 전개한다.', latex: "f^{\\prime}(x)=2x", originalStep: 'model rewrite', evidence: '문제의 함수식', graph: null, figureRecipe: null }],
      answer: '2x', uncertainties: [], checks: { math: [], sequence: [], graph: [] } }],
    references: [{ id: 'P01', title: 'model title', reason: '미분계수 정의를 쓰는 관찰과 연결된다.' }], limitations: [],
  };
}
