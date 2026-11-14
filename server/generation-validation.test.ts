import { describe, expect, it } from 'vitest';
import { validateStepGraph, preserveReadSequence } from './generation-validation.ts';

const step = (id: string, after: string[] = [], branch: string | null = null) => ({ id, after, branch, originalStep: id });

describe('generation sequence validation', () => {
  it('retains independent conditions and a separate alternative', () => {
    // Given
    const source = [step('S01'), step('S02'), step('S03', ['S01', 'S02']), step('S04', [], 'separate_alternative')];
    // When
    const result = preserveReadSequence(source.map((item) => ({ ...item, text: item.originalStep })), source);
    // Then
    expect(result).toEqual(source);
  });

  it('rejects a cycle rather than presenting a fabricated order', () => {
    // Given
    const source = [step('S01', ['S02']), step('S02', ['S01'])];
    // When / Then
    expect(() => validateStepGraph(source)).toThrow();
  });

  it('rejects an unknown dependency', () => {
    // Given
    const source = [step('S01', ['other-question-S01'])];
    // When / Then
    expect(() => validateStepGraph(source)).toThrow();
  });

  it('rejects replacing a parallel original dependency with a linear one', () => {
    // Given
    const reading = [{ id: 'S01', text: '조건 (가)', after: [], branch: null }, { id: 'S02', text: '조건 (나)', after: [], branch: null }];
    const generated = [step('S01'), step('S02', ['S01'])];
    // When / Then
    expect(() => preserveReadSequence(reading, generated)).toThrow();
  });
});
