// L'API sérialise le Taux de TVA en fraction exacte (11/200) pour rester juste
// au centime ; l'écran, lui, parle en pourcentage. On divise après avoir
// multiplié pour éviter le 0,1 × 100 = 10,000000000000002 de la virgule flottante.
export const taxRateLabel = (taxRate: { numerator: number; denominator: number }): string =>
  `${((taxRate.numerator * 100) / taxRate.denominator).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
