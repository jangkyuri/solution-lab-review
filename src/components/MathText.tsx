import { Fragment } from 'react';
import katex from 'katex';

type Props = { readonly text: string; readonly display?: boolean };

export function Formula({ text, display = true }: Props) {
  if (!text.trim()) return null;
  const html = katex.renderToString(text, { displayMode: display, throwOnError: false, trust: false, strict: 'warn', maxExpand: 500, maxSize: 20 });
  return <span className={display ? 'formula display-formula' : 'formula'} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MathText({ text }: Props) {
  const pieces = text.split(/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^\n$]+\$)/gu);
  return <>{pieces.map((piece, index) => {
    if (piece.startsWith('$$') && piece.endsWith('$$')) return <Formula key={index} text={piece.slice(2, -2)} />;
    if (piece.startsWith('\\[') && piece.endsWith('\\]')) return <Formula key={index} text={piece.slice(2, -2)} />;
    if (piece.startsWith('\\(') && piece.endsWith('\\)')) return <Formula key={index} text={piece.slice(2, -2)} display={false} />;
    if (piece.startsWith('$') && piece.endsWith('$')) return <Formula key={index} text={piece.slice(1, -1)} display={false} />;
    return <Fragment key={index}>{piece}</Fragment>;
  })}</>;
}
