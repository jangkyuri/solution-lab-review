export type AppStatus = 400 | 404 | 408 | 409 | 413 | 415 | 429 | 500 | 503;

export class AppError extends Error {
  readonly status: AppStatus;
  constructor(status: AppStatus, message: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

export function safeMessage(error: unknown): string {
  if (!(error instanceof Error)) return '처리 중 오류가 발생했습니다.';
  return error.message.replace(/sk-[A-Za-z0-9_-]+/gu, '[보호된 키]').slice(0, 1000);
}
