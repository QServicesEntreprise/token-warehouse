import { describe, expect, it } from 'vitest';
import { mapDashboard } from './map-dashboard';
import { mapDashboardCalendar } from './map-dashboard-calendar';
import { DashboardCalendarDto } from './dashboard-calendar.dto';
import { DashboardDto } from './dashboard.dto';

describe('mapDashboard', () => {
  it('maps the transport contract to Pilotage projections', () => {
    const dto: DashboardDto = {
      kpis: { physicalStock: 9, sellableStock: 5, nonSellableStock: 4 },
      alerts: {
        outOfStock: [],
        notSellable: [{
          ean13: '2345678901234',
          name: 'Article archivé',
          articleType: 'nonFood',
          lifecycleStatus: 'ARCHIVED',
          physicalStock: 4,
          sellableStock: 0,
          nonSellableStock: 4,
          availability: 'NOT_SELLABLE',
          reason: 'ARCHIVED',
        }],
      },
      stockByArticle: [],
      flowsByDay: [{ date: '2030-01-15', supplies: 3, sales: 1 }],
      financial: {
        revenueHtCents: 1000,
        revenueTtcCents: 1055,
        vatCollectedCents: 55,
        byTaxRate: [{
          taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
          amountHtCents: 1000,
          vatCents: 55,
          amountTtcCents: 1055,
        }],
      },
    };

    expect(mapDashboard(dto)).toEqual({
      kpis: { physicalStock: 9, sellableStock: 5, nonSellableStock: 4 },
      alerts: {
        outOfStock: [],
        notSellable: [{
          ean13: '2345678901234',
          name: 'Article archivé',
          articleType: 'nonFood',
          lifecycleStatus: 'ARCHIVED',
          physicalStock: 4,
          sellableStock: 0,
          nonSellableStock: 4,
          availability: 'NOT_SELLABLE',
          reason: 'ARCHIVED',
        }],
      },
      stockByArticle: [],
      flowsByDay: [{ date: '2030-01-15', supplies: 3, sales: 1 }],
      financial: {
        revenueHtCents: 1000,
        revenueTtcCents: 1055,
        vatCollectedCents: 55,
        byTaxRate: [{
          taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
          amountHtCents: 1000,
          vatCents: 55,
          amountTtcCents: 1055,
        }],
      },
    });
  });

  it('keeps only the warehouse calendar fields used by Pilotage', () => {
    const dto: DashboardCalendarDto = {
      status: 'ok',
      provider: 'sqlite',
      warehouseDate: '2030-03-15',
      currentMonth: { from: '2030-03-01', to: '2030-03-31' },
    };

    expect(mapDashboardCalendar(dto)).toEqual({
      warehouseDate: '2030-03-15',
      currentMonth: { from: '2030-03-01', to: '2030-03-31' },
    });
  });
});
