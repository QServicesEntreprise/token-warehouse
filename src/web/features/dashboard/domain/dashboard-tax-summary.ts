export interface DashboardTaxSummary {
  taxRate: {
    code: 'takeaway' | 'onsite' | 'nonFood';
    ratio: string;
    numerator: number;
    denominator: number;
  };
  amountHtCents: number;
  vatCents: number;
  amountTtcCents: number;
}
