import { spawn } from 'node:child_process';
import { access, readFile, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './errors.ts';

const workspace = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const texBinary = path.join(workspace, 'tmp', 'texlive-v2026.11', 'TinyTeX', 'bin', 'windows', 'xelatex.exe');
const maxOutput = 2 * 1024 * 1024;

export type ProcessOutput = { readonly stdout: string; readonly stderr: string };

export class PdfProcessError extends AppError {
  readonly details: string;
  constructor(message: string, details: string) {
    super(503, message);
    this.name = 'PdfProcessError';
    this.details = details;
  }
}

export function runPdfProcess(command: string, args: readonly string[], cwd: string, timeoutMs = 120_000): Promise<ProcessOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${path.dirname(command)}${path.delimiter}${process.env['PATH'] ?? ''}`, openin_any: 'p', openout_any: 'p' },
    });
    let stdout = '';
    let stderr = '';
    let completed = false;
    const finishError = (error: Error): void => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      child.kill();
      reject(error);
    };
    const timer = setTimeout(() => finishError(new AppError(503, 'PDF 조판 시간이 초과되었습니다. 문항을 나누어 다시 내보내 주세요.')), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxOutput) finishError(new AppError(503, 'PDF 조판 결과가 너무 커서 중단했습니다.'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxOutput) finishError(new AppError(503, 'PDF 조판 결과가 너무 커서 중단했습니다.'));
    });
    child.once('error', (error) => finishError(new AppError(503, `PDF 조판 도구를 실행하지 못했습니다: ${error.message}`)));
    child.once('close', (code) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new PdfProcessError(/Problem recap too long/u.test(stdout + stderr)
        ? '문제 본문이 한 페이지 머리말에 들어가지 않습니다. 문항을 나누어 내보내 주세요.'
        : `PDF 수식 조판을 완료하지 못했습니다. 지원하지 않는 수식이나 원본 파일을 확인해 주세요. ${String(code ?? '')}`, stdout + stderr));
    });
  });
}

export async function compilePdf(stage: string): Promise<number> {
  let executable = process.env['SOLUTION_LAB_XELATEX'] || texBinary;
  try { await access(executable); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new AppError(503, 'XeLaTeX 실행 파일을 찾지 못했습니다. 앱의 PDF 도구 설정을 확인해 주세요.');
  }
  let alias: string | null = null;
  try {
    if (executable === texBinary && /[^\x00-\x7F]/u.test(executable)) {
      alias = path.join(stage, 'tex-runtime');
      await symlink(path.dirname(path.dirname(path.dirname(executable))), alias, 'junction');
      executable = path.join(alias, 'bin', 'windows', 'xelatex.exe');
    }
    const result = await runPdfProcess(executable, ['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-output-directory=build', 'main.tex'], stage);
    const log = await readFile(path.join(stage, 'build', 'main.log'), 'utf8');
    if (/Missing character:|Overfull \\vbox|Overfull \\hbox/u.test(log)) {
      throw new AppError(409, 'PDF에 넘치는 수식이나 표시할 수 없는 글자가 있어 내보내기를 멈췄습니다. 문항 또는 수식을 나누어 주세요.');
    }
    const count = (result.stdout + log).match(/Output written on .*?\((\d+) pages?/u)?.[1];
    if (count === undefined) throw new AppError(503, 'PDF 페이지 수를 확인하지 못했습니다.');
    return Number(count);
  } finally {
    if (alias !== null) {
      try { await unlink(alias); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    }
  }
}

export async function convertWebp(source: string, destination: string, stage: string): Promise<void> {
  const python = path.join(workspace, 'solution-lab', 'python', '.venv', 'Scripts', 'python.exe');
  const script = 'from PIL import Image; import sys\nwith Image.open(sys.argv[1]) as image:\n image.convert("RGBA").save(sys.argv[2], "PNG")';
  await runPdfProcess(python, ['-c', script, source, destination], stage, 30_000);
}

export async function verifyPdf(file: string): Promise<void> {
  const bytes = await readFile(file);
  if (bytes.length < 100 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new AppError(503, '완성된 PDF 파일을 확인하지 못했습니다.');
}
