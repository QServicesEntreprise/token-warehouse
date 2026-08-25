/** Renders whole cents as the editable euro text the Gestionnaire sees in a price field. */
export function eurosInputValue(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}
