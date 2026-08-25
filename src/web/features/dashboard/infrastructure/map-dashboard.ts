import type { Dashboard } from '../domain/dashboard';
import type { DashboardStockLine } from '../domain/dashboard-stock-line';
import type { DashboardDto } from './dashboard.dto';

export function mapDashboard(dto: DashboardDto): Dashboard {
  const mapStockLine = (line: DashboardDto['stockByArticle'][number]): DashboardStockLine => ({ ...line });

  return {
    kpis: { ...dto.kpis },
    alerts: {
      outOfStock: dto.alerts.outOfStock.map(mapStockLine),
      notSellable: dto.alerts.notSellable.map(mapStockLine),
    },
    stockByArticle: dto.stockByArticle.map(mapStockLine),
    financial: dto.financial == null ? null : {
      revenueHtCents: dto.financial.revenueHtCents,
      revenueTtcCents: dto.financial.revenueTtcCents,
      vatCollectedCents: dto.financial.vatCollectedCents,
      byTaxRate: dto.financial.byTaxRate.map(line => ({
        ...line,
        taxRate: { ...line.taxRate },
      })),
    },
  };
}
