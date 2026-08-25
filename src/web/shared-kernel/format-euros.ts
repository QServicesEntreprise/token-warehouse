const PLAIN = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const SIGNED = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', signDisplay: 'exceptZero' });

export function formatEuros(cents: number, signed = false): string {
  return (signed ? SIGNED : PLAIN).format(cents / 100);
}
