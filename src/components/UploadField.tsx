import { FileImage, FileText, Upload, X } from 'lucide-react';
import type { ChangeEvent } from 'react';

type Props = {
  readonly id: string; readonly label: string; readonly files: readonly File[];
  readonly onChange: (files: File[]) => void; readonly onError: (error: string) => void;
};

export function UploadField({ id, label, files, onChange, onError }: Props) {
  function addFiles(event: ChangeEvent<HTMLInputElement>): void {
    const next = Array.from(event.currentTarget.files ?? []);
    const invalid = next.find(file => !/\.(pdf|png|jpe?g|webp)$/iu.test(file.name));
    if (invalid) onError('PDF, PNG, JPG 또는 WEBP 파일을 선택해주세요.');
    else { onError(''); onChange([...files, ...next]); }
    event.currentTarget.value = '';
  }
  return <section className="upload-field" aria-labelledby={`${id}-label`}>
    <h3 id={`${id}-label`}>{label}</h3>
    <div className="upload-zone">
      <Upload size={23} strokeWidth={1.6} />
      <span>PDF · PNG · JPG · WEBP</span>
      <label className="button secondary file-picker" htmlFor={id}>파일 선택
        <input id={id} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple onChange={addFiles} />
      </label>
    </div>
    {files.length > 0 && <ul className="selected-files">{files.map((file, index) =>
      <li key={`${file.name}-${file.lastModified}-${index}`}>
        {file.type === 'application/pdf' ? <FileText size={17} /> : <FileImage size={17} />}
        <span title={file.name}>{file.name}<small>{formatBytes(file.size)}</small></span>
        <button type="button" className="icon-button" aria-label={`${file.name} 제거`}
          onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}><X size={16} /></button>
      </li>)}</ul>}
  </section>;
}

function formatBytes(bytes: number): string {
  return bytes < 1_048_576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
}
