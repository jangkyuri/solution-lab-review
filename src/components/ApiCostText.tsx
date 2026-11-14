import type { ApiCost } from '../../shared/contracts';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4,
});
const integer = new Intl.NumberFormat('ko-KR');

type Props = {
  readonly label: string;
  readonly cost: ApiCost | undefined;
  readonly running?: boolean;
  readonly compact?: boolean;
};

export function ApiCostText({ label, cost, running, compact }: Props) {
  if (!cost || cost.estimatedUsd === null) {
    const message = cost ? '계산 불가' : running ? '집계 중' : '기록 없음';
    return <span>{label} · {message}{cost && !compact && ` · ${integer.format(cost.requests)}회 · ${integer.format(cost.inputTokens + cost.outputTokens)}토큰`}</span>;
  }

  const amount = cost.estimatedUsd;
  const formattedAmount = amount > 0 && amount < 0.0001 ? '<$0.0001' : usd.format(amount);
  const estimateLabel = cost.status === 'partial' ? '일부 추정' : '추정';
  return <span>{label} · {estimateLabel} <b>{formattedAmount}</b>{!compact && ` · ${integer.format(cost.requests)}회`}</span>;
}
