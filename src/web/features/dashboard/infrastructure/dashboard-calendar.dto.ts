export interface DashboardCalendarDto {
  status: 'ok';
  provider: string;
  warehouseDate: string;
  currentMonth: {
    from: string;
    to: string;
  };
}
