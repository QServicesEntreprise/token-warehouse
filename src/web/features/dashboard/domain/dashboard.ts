import type { DashboardStockLine } from './dashboard-stock-line';
import type { DashboardTaxSummary } from './dashboard-tax-summary';

export interface Dashboard {
  kpis: {
    physicalStock: number;
    sellableStock: number;
    nonSellableStock: number;
  };
  alerts: {
    outOfStock: DashboardStockLine[];
    notSellable: DashboardStockLine[];
  };
  stockByArticle: DashboardStockLine[];
  financial: {
    revenueHtCents: number;
    revenueTtcCents: number;
    vatCollectedCents: number;
    byTaxRate: DashboardTaxSummary[];
  } | null;
}
