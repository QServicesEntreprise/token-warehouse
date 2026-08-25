import { Observable } from 'rxjs';
import type { Dashboard } from '../domain/dashboard';
import type { DashboardCalendar } from '../domain/dashboard-calendar';
import type { DashboardFilter } from '../domain/dashboard-filter';

export abstract class DashboardGateway {
  abstract getCalendar(): Observable<DashboardCalendar>;
  abstract getDashboard(filter: DashboardFilter): Observable<Dashboard>;
}
