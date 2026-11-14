import { describe, expect, it } from 'vitest';
import { StepBookletSchema } from './contracts.ts';

describe('optional student booklet emphasis', () => {
  it('preserves selective equation and phrase emphasis while accepting older layouts', () => {
    expect(StepBookletSchema.parse({})).toEqual({});
    expect(StepBookletSchema.parse({ equationRole: 'key', keyPhrases: ['접선의 기울기'] })).toEqual({ equationRole: 'key', keyPhrases: ['접선의 기울기'] });
    expect(StepBookletSchema.parse({ equationRole: 'normal' })).toEqual({ equationRole: 'normal' });
  });

  it('bounds phrase count and length and restricts equation roles', () => {
    expect(StepBookletSchema.safeParse({ equationRole: 'large' }).success).toBe(false);
    expect(StepBookletSchema.safeParse({ keyPhrases: ['첫째', '둘째', '셋째'] }).success).toBe(false);
    expect(StepBookletSchema.safeParse({ keyPhrases: ['가'.repeat(121)] }).success).toBe(false);
    expect(StepBookletSchema.safeParse({ keyPhrases: [''] }).success).toBe(false);
  });
});
