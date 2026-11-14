import type { Reading } from './generation-schemas.ts';

type SourceQuestion = Reading['questions'][number];

export function hasUncertainSourceErrorClaim(source: SourceQuestion, claims: readonly string[]): boolean {
  if (!source.uncertainties.length) return false;
  return claims.some((claim) => {
    const qualified = /확정(?:하지|할\s*수\s*없)|단정(?:하지|할\s*수\s*없)|오류(?:인지|일\s*수)|불확실/u.test(claim);
    if (qualified) return false;
    const explicitReadingReclassification = /판독\s*(?:의\s*)?차이[^.\n]{0,30}(?:아니라|아닌)[^.\n]{0,30}계산\s*오류/u.test(claim);
    const sourceIdentity = /원문|원래\s*필기|필기|손글씨|손풀이|교사|적힌/u.test(claim);
    const definiteError = /오류|잘못|틀렸|틀린/u.test(claim);
    return explicitReadingReclassification || (sourceIdentity && definiteError);
  });
}
