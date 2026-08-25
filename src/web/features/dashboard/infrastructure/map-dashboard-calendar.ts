import type { DashboardCalendar } from '../domain/dashboard-calendar';
import type { DashboardCalendarDto } from './dashboard-calendar.dto';

export function mapDashboardCalendar(dto: DashboardCalendarDto): DashboardCalendar {
  return {
    warehouseDate: dto.warehouseDate,
    currentMonth: { ...dto.currentMonth },
  };
}
