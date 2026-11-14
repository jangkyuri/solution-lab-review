import { Fragment } from 'react';
import { Formula } from './MathText';

export function CriteriaView({ text }: { readonly text: string }) {
  return <section className="page-content criteria-view">
    <article className="criteria-document">
      <h2>손해설 제작 기준 v1</h2>
      <ul>
        <li>문제의 번호, 조건, 보기를 원본에서 읽습니다. 손풀이가 있으면 미지수와 풀이 순서를 따릅니다.</li>
        <li>정답과 핵심을 먼저 쓰고, 각 단계에는 판단 하나와 그 이유를 적습니다.</li>
        <li>해당 과목의 고등학교 수학 표현을 쓰고, 그래프는 식이나 조건을 읽는 데 필요할 때 넣습니다.</li>
        <li>그래프의 식과 라벨은 축, 곡선, 직선, 보조선, 점과 겹치지 않게 배치합니다.</li>
        <li>정적분의 끝값을 대입할 때는 <Formula text={String.raw`\left[F(x)\right]_{a}^{b}`} display={false} />처럼 대괄호를 씁니다.</li>
        <li>손풀이와 계산이 다르거나 원본 판독이 애매하면 문항 끝에 ‘[확인 필요]’를 표시합니다.</li>
      </ul>
      <details>
        <summary>손풀이 보강 기준 자세히 보기</summary>
        {text.trim().split(/\r?\n[ \t]*\r?\n/u).map((block, index) => <CriteriaBlock key={index} block={block.trim()} />)}
      </details>
    </article>
  </section>;
}

function CriteriaBlock({ block }: { readonly block: string }) {
  if (!block) return null;
  const lines = block.split(/\r?\n/u);
  const heading = lines.length === 1 ? /^(#{1,4})\s+(.+)$/u.exec(block) : null;
  if (heading) {
    const Tag = heading[1] === '#' ? 'h2' : heading[1] === '##' ? 'h3' : 'h4';
    return <Tag><CriteriaText text={heading[2] ?? ''} /></Tag>;
  }

  const unordered = /^-\s+/u;
  const ordered = /^\d+\.\s+/u;
  const marker = lines.every(line => unordered.test(line)) ? unordered
    : lines.every(line => ordered.test(line)) ? ordered : null;
  if (marker) {
    const Tag = marker === ordered ? 'ol' : 'ul';
    return <Tag>{lines.map((line, index) => <li key={index}><CriteriaText text={line.replace(marker, '')} /></li>)}</Tag>;
  }

  const [columns, divider, ...rows] = lines.map(line => line.trim().split('|').slice(1, -1).map(cell => cell.trim()));
  if (lines.every(line => /^\|.*\|$/u.test(line.trim())) && columns && columns.length > 1
    && divider?.length === columns.length && divider.every(cell => /^:?-{3,}:?$/u.test(cell))
    && rows.every(row => row.length === columns.length)) {
    return <table><thead><tr>{columns.map((cell, index) => <th key={index} scope="col"><CriteriaText text={cell} /></th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}><CriteriaText text={cell} /></td>)}</tr>)}</tbody>
    </table>;
  }
  return <p><CriteriaText text={block} /></p>;
}

function CriteriaText({ text }: { readonly text: string }) {
  return <>{text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\))/gu).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\([^)]+\)$/u.exec(part);
    return <Fragment key={index}>{link ? link[1] : part}</Fragment>;
  })}</>;
}
