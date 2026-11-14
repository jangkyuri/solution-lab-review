import { readFile } from 'node:fs/promises';

import curriculum from './hand-solution-v1/curriculum.json' with { type: 'json' };

export async function handSolutionRules(subject: string): Promise<string> {
  const [policy, prohibited] = await Promise.all([
    readFile(new URL('./hand-solution-v1/production.md', import.meta.url), 'utf8'),
    readFile(new URL('./hand-solution-v1/해설생성-금지항목-20261104.md', import.meta.url), 'utf8'),
  ]);
  const courses = Object.values(curriculum.subjects);
  const subjectName = subject.normalize('NFKC').replace(/\s+/gu, '').replace(/^미적(?=[12]$)/u, '미적분');
  const selected = courses.find(course => course.aliases.some(alias =>
    alias.normalize('NFKC').replace(/\s+/gu, '') === subjectName,
  ));
  const allowedCourses: readonly string[] = selected?.allowedCourses ?? [];
  const syllabus = Object.entries(curriculum.subjects)
    .filter(([id]) => !selected || allowedCourses.includes(id))
    .map(([, course]) => course.text);
  const scope = selected
    ? `선택한 과목은 ${selected.name}이다. 아래 자료의 허용 범위와 각 경계를 적용한다.`
    : '과목이 확정되지 않았다. 문제에서 과목을 판별하고 해당 과목의 범위 안에서만 설명한다.';

  return [policy, prohibited, scope, ...syllabus].join('\n\n');
}
