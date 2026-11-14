import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { MAX_JOB_INSTRUCTION_LENGTH } from '../../shared/contracts';
import type { Mode } from '../../shared/contracts';
import { UploadField } from './UploadField';

type Props = {
  readonly busy: boolean; readonly onCreate: (body: FormData) => Promise<void>;
  readonly defaultDesignTitle?: string | null;
  readonly onDesignLibrary?: () => void;
};

const suggestions = [
  { label: '그래프와 식 연결', text: '그래프에서 읽은 점, 높이, 구간이 식의 어느 부분에 들어가는지 단계마다 짚어주세요.' },
  { label: '경우 나누기', text: '경우를 나누는 기준과 각 경우에서 확인해야 할 경계를 설명해주세요.' },
  { label: '학생 눈높이', text: '학생이 막힐 만한 단계에서 앞 식과 다음 식이 이어지는 이유를 쉬운 말로 설명해주세요.' },
] as const;

const modes = [
  { value: 'solve', label: '새 풀이 작성' },
  { value: 'supplement', label: '손풀이 보강' },
] as const;

export function NewJob({ busy, onCreate, defaultDesignTitle, onDesignLibrary }: Props) {
  const [mode, setMode] = useState<Mode>('solve');
  const [examFiles, setExamFiles] = useState<File[]>([]);
  const [solutionFiles, setSolutionFiles] = useState<File[]>([]);
  const [instruction, setInstruction] = useState('');
  const [error, setError] = useState('');
  const instructionLines = instruction.split('\n');

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (examFiles.length === 0) {
      setError('문제 파일을 올려주세요.'); return;
    }
    const body = new FormData(event.currentTarget);
    const teacherText = String(body.get('teacherText') ?? '').trim();
    if (mode === 'supplement' && solutionFiles.length === 0 && teacherText.length === 0) {
      setError('보강할 손풀이 파일을 올리거나 원래 풀이를 입력해주세요.'); return;
    }
    body.set('mode', mode);
    examFiles.forEach(file => body.append('examFiles', file));
    if (mode === 'supplement') solutionFiles.forEach(file => body.append('solutionFiles', file));
    setError('');
    await onCreate(body);
  }

  return <div className="work-content new-job-content">
    <TabList className="astryx-job-tabs" role="tablist" aria-label="작업 방식" hasDivider size="lg" value={mode}
      onChange={value => { if (value === 'solve' || value === 'supplement') setMode(value); }}>
      {modes.map(({ value, label }) => <Tab key={value} id={`job-mode-${value}`} value={value} label={label} panelId="new-job-options" />)}
    </TabList>
    <div id="new-job-options" role="tabpanel" aria-labelledby={`job-mode-${mode}`}>
      {onDesignLibrary && <p className="new-job-design source-meta">기본 디자인 · {defaultDesignTitle ?? '기본 조판'}
        <button type="button" className="text-button" onClick={onDesignLibrary}>출력 디자인 열기</button>
      </p>}
      <form className="job-form" onSubmit={event => void submit(event)}>
        <div className="form-row">
          <label className="field">작업 이름<input name="title" required maxLength={160} placeholder="예) 미적1 기말 프린트" /></label>
          <label className="field subject-field">과목<select name="subject" defaultValue="미적1">
            {['미적1', '미적2', '대수', '공통수학1', '공통수학2', '기하', '확률과 통계', '기타'].map(subject => <option key={subject}>{subject}</option>)}
          </select></label>
        </div>
        <UploadField id="exam-upload" label="문제 파일 (필수)" files={examFiles} onChange={setExamFiles} onError={setError} />
        {mode === 'supplement' && <>
          <UploadField id="solution-upload" label="선생님 손풀이" files={solutionFiles} onChange={setSolutionFiles} onError={setError} />
          <label className="field">원래 풀이 직접 입력
            <textarea name="teacherText" rows={4} />
          </label>
        </>}
        <div className="instruction-field">
          <label className="field">추가 요청 <span className="label-optional">선택</span>
            <textarea name="instruction" rows={3} value={instruction} maxLength={MAX_JOB_INSTRUCTION_LENGTH}
              onChange={event => setInstruction(event.currentTarget.value)}
              placeholder="예) 1~13번만 풀이" />
          </label>
          <div className="instruction-suggestions" role="group" aria-label="추가 요청 예시">
            {suggestions.map(suggestion => {
              const selectedLine = instructionLines.indexOf(suggestion.text);
              const selected = selectedLine >= 0;
              const added = instruction ? `${instruction}\n${suggestion.text}` : suggestion.text;
              return <button key={suggestion.label} className="button secondary" type="button" aria-pressed={selected}
                disabled={!selected && added.length > MAX_JOB_INSTRUCTION_LENGTH}
                onClick={() => setInstruction(selected ? instructionLines.filter((_, index) => index !== selectedLine).join('\n') : added)}>{suggestion.label}</button>;
            })}
          </div>
        </div>
        {error && <p className="notice error" role="alert">{error}</p>}
        <Button className="create-button" variant="primary" size="lg" width="100%" isDisabled={busy} type="submit"
          label={busy ? '저장 중…' : '작업 저장'} />
      </form>
    </div>
  </div>;
}
