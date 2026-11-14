import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { GraphSchema, PointSchema } from '../shared/contracts.ts';
import type { Graph } from '../shared/contracts.ts';
import { CheckMathRequestSchema, CheckMathResponseSchema } from '../shared/math.ts';
import type { CheckMathInput, CheckMathResponse } from '../shared/math.ts';
import { AppError } from './errors.ts';

const runtimeRoot = fileURLToPath(new URL('../python/', import.meta.url));
const WorkerErrorSchema = z.object({ error: z.string().max(2000) });
const SampleResponseSchema = z.object({
  expression: z.string(), variable: z.string(),
  segments: z.array(z.array(PointSchema)), discontinuities: z.array(z.number().finite()),
});
export type SampleResult = z.infer<typeof SampleResponseSchema>;
const workerLimit = 2;
let runningWorkers = 0;
const waitingWorkers: (() => void)[] = [];

async function acquireWorker(): Promise<void> {
  if (runningWorkers < workerLimit) { runningWorkers += 1; return; }
  if (waitingWorkers.length >= 16) throw new AppError(503, '계산 대기 중인 작업이 많습니다. 잠시 뒤 다시 실행해주세요.');
  await new Promise<void>((resume) => waitingWorkers.push(resume));
}

function releaseWorker(): void {
  const next = waitingWorkers.shift();
  if (next) next();
  else runningWorkers -= 1;
}

export function pythonExecutable(): string {
  const executable = process.env['SOLUTION_LAB_PYTHON'] ?? resolve(runtimeRoot,
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  if (!existsSync(executable)) throw new AppError(503, '계산 환경이 준비되지 않았습니다. 앱의 계산 환경 설치 안내를 확인해주세요.');
  return executable;
}

export async function withMathWorker<T>(run: () => Promise<T>): Promise<T> {
  await acquireWorker();
  try { return await run(); }
  finally { releaseWorker(); }
}

function invokeMath(input: Readonly<Record<string, unknown>>, timeout = 30_000): Promise<unknown> {
  return withMathWorker(() => runMathWorker(input, timeout));
}

async function runMathWorker(input: Readonly<Record<string, unknown>>, timeout: number): Promise<unknown> {
  const sampling = input['action'] === 'sample';
  if (!sampling) await mkdir(resolve(runtimeRoot, '.mpl-cache'), { recursive: true });
  return new Promise((resolveResult, reject) => {
    const child = spawn(pythonExecutable(), [resolve(runtimeRoot, sampling ? 'graph_sampling.py' : 'main.py')], {
      cwd: runtimeRoot, windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', MPLCONFIGDIR: resolve(runtimeRoot, '.mpl-cache') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(error);
    };
    const timer = setTimeout(() => finish(new AppError(408, '계산 시간이 길어 중단했습니다. 식을 단순하게 나누어 확인해주세요.')), timeout);
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) { finish(new AppError(413, '계산 결과가 허용 크기를 넘었습니다.')); return; }
      output.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) finish(new AppError(413, '계산 결과가 허용 크기를 넘었습니다.'));
    });
    child.on('error', () => finish(new AppError(503, '계산 도구를 시작하지 못했습니다.')));
    child.stdin.on('error', () => finish(new AppError(503, '계산 도구에 입력을 전달하지 못했습니다.')));
    child.on('close', (code) => {
      if (settled) return;
      clearTimeout(timer);
      try {
        const response: unknown = JSON.parse(Buffer.concat(output).toString('utf8'));
        const error = WorkerErrorSchema.safeParse(response);
        if (error.success) { finish(new AppError(400, error.data.error)); return; }
        if (code !== 0) { finish(new AppError(500, '계산 도구가 작업을 완료하지 못했습니다.')); return; }
        settled = true;
        resolveResult(response);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        finish(new AppError(500, '계산 도구의 응답을 읽지 못했습니다.'));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

export async function checkMath(input: CheckMathInput): Promise<CheckMathResponse> {
  const request = CheckMathRequestSchema.parse(input);
  return CheckMathResponseSchema.parse(await invokeMath({ action: 'check', ...request }));
}

export async function sampleMathExpression(expression: string, from: number, to: number, variable = 'x', count = 201): Promise<SampleResult> {
  return SampleResponseSchema.parse(await invokeMath({ action: 'sample', expression, from, to, variable, count }));
}

export type GraphPrintOptions = {
  readonly width?: number;
  readonly highlight?: {
    readonly xMin: number;
    readonly xMax: number;
    readonly yMin: number;
    readonly yMax: number;
  };
};

export async function renderGraph(
  input: Graph, outputPath: string, format: 'pdf' | 'svg' = 'pdf', style: 'standard' | 'baeksin' = 'standard',
  options?: GraphPrintOptions,
): Promise<string> {
  const graph = GraphSchema.parse(input);
  const destination = resolve(outputPath);
  if (!destination.toLowerCase().endsWith(`.${format}`)) throw new AppError(400, '그래프 파일 확장자와 출력 형식이 다릅니다.');
  await mkdir(dirname(destination), { recursive: true });
  const response = z.object({ path: z.string() }).parse(await invokeMath({ action: 'render', graph, outputPath: destination, format, style, options }, 90_000));
  if (response.path !== destination) throw new AppError(500, '그래프 출력 위치를 확인하지 못했습니다.');
  return response.path;
}
