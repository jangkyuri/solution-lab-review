import { formatBookletInlineTex, safeMath } from './pdf-safety.ts';

const mathAtom = String.raw`[A-Za-z0-9\\{}\[\]()^_+*/=<>.,'′|-]+`;
const mathRuns = new RegExp(String.raw`${mathAtom}(?:[ \t]*[+*/=<>-][ \t]*${mathAtom})*`, 'gu');

function numericFractions(value: string): string {
  return value.replace(/(?<![\p{L}\p{N}_.^}-])(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)(?![\p{L}\p{N}_.])/gu,
    (_whole, numerator: string, denominator: string) => `\\frac{${numerator}}{${denominator}}`);
}

function formatRawRuns(value: string): string {
  let output = '';
  let end = 0;
  for (const match of value.matchAll(mathRuns)) {
    output += formatBookletInlineTex(value.slice(end, match.index));
    const candidate = match[0];
    const looksMathematical = /^[A-Za-z]$/u.test(candidate) || /^\d+(?:\.\d+)?$/u.test(candidate) || /[\\^_+*/=<>()[\]'′|-]/u.test(candidate);
    const math = looksMathematical ? safeMath(numericFractions(candidate)) : null;
    output += math === null ? formatBookletInlineTex(candidate) : formatBookletInlineTex(`\\(${math}\\)`);
    end = match.index + candidate.length;
  }
  return output + formatBookletInlineTex(value.slice(end));
}

export function formatBookletTableCell(value: string): string {
  let output = '';
  let end = 0;
  for (const match of value.matchAll(/\\\(([\s\S]*?)\\\)|\$([^$\n]+)\$/gu)) {
    output += formatRawRuns(value.slice(end, match.index));
    output += formatBookletInlineTex(match[0]);
    end = match.index + match[0].length;
  }
  return output + formatRawRuns(value.slice(end));
}
