import type { GeneratedResult, Reading } from './generation-schemas.ts';

type CorrectionDrafts = { readonly previous: GeneratedResult; readonly regenerated: GeneratedResult; readonly issues: readonly string[] };
const globalImpact = /\b(?:answer|firstDecision|problemText|variables|observedOrder|summary|references|limitations|uncertainties|checks)\b|정답|최종\s*답|첫\s*판단|핵심\s*한\s*줄|확인\s*필요|다른\s*단계|여러\s*단계|전체\s*(?:풀이|문항)|전체(?:에|의)?\s*영향|문항의?\s*(?:결론|요약)/iu;

function matchesSource(reading: Reading, draft: GeneratedResult): boolean {
  if (draft.questions.length !== reading.questions.length || new Set(draft.questions.map((question) => question.number)).size !== reading.questions.length) return false;
  return reading.questions.every((source) => {
    const question = draft.questions.find((item) => item.number === source.number);
    return question !== undefined && question.steps.length === source.observedSteps.length && source.observedSteps.every((original) => {
      const step = question.steps.find((item) => item.id === original.id);
      return step !== undefined && step.branch === original.branch && step.after.length === original.after.length && original.after.every((id) => step.after.includes(id));
    });
  });
}

export function correctionTargets(reading: Reading, correction: Pick<CorrectionDrafts, 'previous' | 'issues'>): ReadonlyMap<string, ReadonlySet<string>> | null {
  const { previous, issues } = correction;
  if (!issues.length || !matchesSource(reading, previous)) return null;
  const knownIds = new Set(reading.questions.flatMap((question) => question.observedSteps.map((step) => step.id)));
  const targets = new Map<string, Set<string>>();
  for (const issue of issues) {
    if (globalImpact.test(issue)) return null;
    const ids = [...new Set(issue.match(/\bS\d+\b/gu) ?? [])];
    if (!ids.length || ids.some((id) => !knownIds.has(id))) return null;
    const explicit = reading.questions.filter((question) => {
      const escaped = question.number.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      return new RegExp(`(?:^|[^\\p{L}\\p{N}_-])${escaped}번`, 'u').test(issue);
    });
    if (explicit.length > 1) return null;
    const candidates = (explicit.length ? explicit : reading.questions)
      .filter((question) => ids.every((id) => question.observedSteps.some((step) => step.id === id)));
    const question = candidates[0];
    if (candidates.length !== 1 || !question) return null;
    const selected = targets.get(question.number) ?? new Set<string>();
    for (const id of ids) selected.add(id);
    targets.set(question.number, selected);
  }
  return targets;
}

export function mergeScopedCorrection(reading: Reading, correction: CorrectionDrafts): GeneratedResult {
  const { previous, regenerated } = correction;
  const targets = correctionTargets(reading, correction);
  if (!targets || !matchesSource(reading, regenerated)) return regenerated;
  return { ...previous, questions: previous.questions.map((question) => {
    const selected = targets.get(question.number);
    if (!selected) return question;
    const fresh = regenerated.questions.find((item) => item.number === question.number);
    if (!fresh) return question;
    return { ...question, steps: question.steps.map((step) => {
      if (!selected.has(step.id)) return step;
      const replacement = fresh.steps.find((item) => item.id === step.id);
      return replacement ? { ...replacement, id: step.id, after: step.after, branch: step.branch, originalStep: step.originalStep } : step;
    }) };
  }) };
}
