import { Observable } from 'rxjs';
import { Dashboard } from '../domain/dashboard';
import { DashboardCalendar } from '../domain/dashboard-calendar';
import { DashboardFilter } from '../domain/dashboard-filter';

export abstract class DashboardGateway {
  abstract getCalendar(): Observable<DashboardCalendar>;
  abstract getDashboard(filter: DashboardFilter): Observable<Dashboard>;
}
