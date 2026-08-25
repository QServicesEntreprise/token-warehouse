const EUROS = /^(-)?(\d+)(?:[.,](\d{1,2}))?$/;

/** Reads a Gestionnaire-typed amount in euros ("12,50" or "12.50") as whole cents. */
export function parseEuros(raw: string): number | null {
  const match = EUROS.exec(raw.trim());
  if (match === null) return null;
  const cents = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  return match[1] === '-' ? -cents : cents;
}
