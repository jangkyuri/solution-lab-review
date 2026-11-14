import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CriteriaView } from './CriteriaView';
import { NewJob } from './NewJob';

describe('next job instructions', () => {
  it('keeps the criteria screen as a reference document', () => {
    const markup = renderToStaticMarkup(<CriteriaView text="# 공통 기준" />);

    expect(markup).toContain('공통 기준');
    expect(markup).toContain('축, 곡선, 직선, 보조선, 점과 겹치지 않게');
    expect(markup).toContain(String.raw`\left[F(x)\right]_{a}^{b}`);
    expect(markup).not.toContain('<textarea');
    expect(markup).not.toContain('<button');
  });

  it('puts request suggestions and the required problem upload in the new job form', () => {
    const markup = renderToStaticMarkup(<NewJob busy={false} onCreate={async () => {}} />);

    expect(markup).toContain('name="instruction"');
    expect(markup).toContain('>경우 나누기</button>');
    expect(markup).toContain('문제 파일 (필수)');
    expect(markup).not.toContain('name="inputText"');
  });
});
