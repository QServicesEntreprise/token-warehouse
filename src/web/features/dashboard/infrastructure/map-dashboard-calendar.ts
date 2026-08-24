import { DashboardCalendar } from '../domain/dashboard-calendar';
import { DashboardCalendarDto } from './dashboard-calendar.dto';

export function mapDashboardCalendar(dto: DashboardCalendarDto): DashboardCalendar {
  return {
    warehouseDate: dto.warehouseDate,
    currentMonth: { ...dto.currentMonth },
  };
}
