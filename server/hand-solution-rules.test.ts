import { describe, expect, it } from 'vitest';
import { handSolutionRules } from './hand-solution-rules.ts';

describe('hand solution production rules', () => {
  it('loads the writing and graph guidance and the selected curriculum', async () => {
    const rules = await handSolutionRules('미적1');

    expect(rules).toContain('손해설 제작 프로젝트 v1');
    expect(rules).toContain('[확인 필요]');
    expect(rules).toContain('차분몫');
    expect(rules).toContain('그림을 읽는 첫 설명과 상세 계산 전에');
    expect(rules).toContain('축·곡선·직선·보조선·점·다른 라벨과 겹치지 않는 빈 자리');
    expect(rules).toContain(String.raw`\left[F(x)\right]_{a}^{b}`);
    expect(rules).toContain('CALC1-DIFFERENTIATION');
    expect(rules).toContain('CM1-POLY');
    expect(rules).not.toContain('CALC2-DIFFERENTIATION');
    expect(rules).not.toContain('GEO-VECTORS');
    expect(await handSolutionRules('미적분Ⅰ')).toBe(rules);
  });

  it('keeps the subject boundaries explicit when the course must be inferred', async () => {
    const rules = await handSolutionRules('기타');

    expect(rules).toContain('문제에서 과목을 판별');
    expect(rules).toContain('GEO-VECTORS');
    expect(rules).toContain('CALC2-DIFFERENTIATION');
  });
});
