import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';
import { DashboardGateway } from '../application/dashboard-gateway';
import { Dashboard } from '../domain/dashboard';
import { DashboardCalendar } from '../domain/dashboard-calendar';
import { DashboardFilter } from '../domain/dashboard-filter';
import { DashboardCalendarDto } from './dashboard-calendar.dto';
import { DashboardDto } from './dashboard.dto';
import { mapDashboard } from './map-dashboard';
import { mapDashboardCalendar } from './map-dashboard-calendar';
import { mapDashboardError } from './map-dashboard-error';

@Injectable()
export class DashboardHttpGateway extends DashboardGateway {
  private readonly http = inject(HttpClient);

  override getCalendar(): Observable<DashboardCalendar> {
    return this.http.get<DashboardCalendarDto>('/health').pipe(
      map(mapDashboardCalendar),
      catchError(error => throwError(() => mapDashboardError(error))),
    );
  }

  override getDashboard(filter: DashboardFilter): Observable<Dashboard> {
    let params = new HttpParams().set('from', filter.from).set('to', filter.to);
    if (filter.type !== null) params = params.set('type', filter.type);
    if (filter.mode !== null) params = params.set('mode', filter.mode);
    if (filter.packaging !== null) params = params.set('packaging', filter.packaging);

    return this.http.get<DashboardDto>('/api/dashboard', { params }).pipe(
      map(mapDashboard),
      catchError(error => throwError(() => mapDashboardError(error))),
    );
  }
}
