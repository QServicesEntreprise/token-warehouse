import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  DashboardApiService,
  DashboardArticleType,
  DashboardLifecycleStatus,
  DashboardResponse,
} from './dashboard-api.service';
import { StockAvailability, StockReason } from './stock-api.service';

type DashboardState = 'loading' | 'ready' | 'empty' | 'error';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="dashboard-panel" class="panel" aria-labelledby="dashboard-title">
      <div>
        <p class="eyebrow">Pilotage courant</p>
        <h2 id="dashboard-title">Dashboard</h2>
      </div>
      <p>Une lecture unique des positions courantes du Catalogue, sans recalcul côté navigateur.</p>

      <div id="dashboard-state" class="catalog-state" aria-live="polite" role="status">
        @switch (dashboardState()) {
          @case ('loading') {
            <p>Chargement du Dashboard…</p>
          }
          @case ('ready') {
            <p>{{ dashboard()?.stockByArticle?.length ?? 0 }} Article{{ (dashboard()?.stockByArticle?.length ?? 0) > 1 ? 's' : '' }} suivi{{ (dashboard()?.stockByArticle?.length ?? 0) > 1 ? 's' : '' }}.</p>
          }
          @case ('empty') {
            <p>Aucun Article n’est présent dans le Catalogue.</p>
          }
          @case ('error') {
            <p class="form-error" role="alert">{{ dashboardError() }}</p>
            <button type="button" class="secondary-button" (click)="retryDashboard()">Réessayer</button>
          }
        }
      </div>

      @if (dashboard(); as current) {
        <div class="dashboard-kpis" aria-label="Indicateurs de Stock courant">
          <article id="dashboard-kpi-physical" class="dashboard-kpi">
            <h3>Stock physique</h3>
            <p>{{ current.kpis.physicalStock }} unités</p>
          </article>
          <article id="dashboard-kpi-sellable" class="dashboard-kpi">
            <h3>Stock vendable</h3>
            <p>{{ current.kpis.sellableStock }} unités</p>
          </article>
          <article id="dashboard-kpi-non-sellable" class="dashboard-kpi">
            <h3>Stock non vendable</h3>
            <p>{{ current.kpis.nonSellableStock }} unités</p>
          </article>
        </div>

        <div class="dashboard-alerts">
          <section id="dashboard-alert-out-of-stock" aria-labelledby="dashboard-out-of-stock-title">
            <h3 id="dashboard-out-of-stock-title">Ruptures actives</h3>
            @if (current.alerts.outOfStock.length > 0) {
              <ul>
                @for (alert of current.alerts.outOfStock; track alert.ean13) {
                  <li><a [href]="dashboardRowHref(alert.ean13)">{{ alert.name }} — {{ alert.ean13 }}</a></li>
                }
              </ul>
            } @else {
              <p>Aucune rupture active.</p>
            }
          </section>

          <section id="dashboard-alert-not-sellable" aria-labelledby="dashboard-not-sellable-title">
            <h3 id="dashboard-not-sellable-title">Articles non vendables</h3>
            @if (current.alerts.notSellable.length > 0) {
              <ul>
                @for (alert of current.alerts.notSellable; track alert.ean13) {
                  <li><a [href]="dashboardRowHref(alert.ean13)">{{ alert.name }} — {{ alert.ean13 }} — {{ formatStockReason(alert.reason) }}</a></li>
                }
              </ul>
            } @else {
              <p>Aucun Article physiquement présent n’est bloqué.</p>
            }
          </section>
        </div>

        @if (current.stockByArticle.length > 0) {
          <div class="table-wrap">
            <table id="dashboard-table">
              <caption class="sr-only">Positions courantes par Article</caption>
              <thead>
                <tr>
                  <th scope="col">Référence EAN-13</th>
                  <th scope="col">Article</th>
                  <th scope="col">Type</th>
                  <th scope="col">Cycle de vie</th>
                  <th scope="col">Stock physique</th>
                  <th scope="col">Stock vendable</th>
                  <th scope="col">Stock non vendable</th>
                  <th scope="col">Disponibilité</th>
                  <th scope="col">Raison</th>
                </tr>
              </thead>
              <tbody>
                @for (row of current.stockByArticle; track row.ean13) {
                  <tr [attr.id]="dashboardRowId(row.ean13)">
                    <td>{{ row.ean13 }}</td>
                    <th scope="row">{{ row.name }}</th>
                    <td>{{ formatDashboardArticleType(row.articleType) }}</td>
                    <td>{{ formatDashboardLifecycle(row.lifecycleStatus) }}</td>
                    <td>{{ row.physicalStock }} unités</td>
                    <td>{{ row.sellableStock }} unités</td>
                    <td>{{ row.nonSellableStock }} unités</td>
                    <td>{{ formatStockAvailability(row.availability) }}</td>
                    <td>{{ formatStockReason(row.reason) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </section>
  `,
})
export class DashboardComponent implements OnInit {
  private readonly api = inject(DashboardApiService);

  readonly dashboard = signal<DashboardResponse | null>(null);
  readonly dashboardState = signal<DashboardState>('loading');
  readonly dashboardError = signal('');

  private requestId = 0;

  ngOnInit(): void {
    void this.loadDashboard();
  }

  retryDashboard(): void {
    void this.loadDashboard();
  }

  formatStockAvailability(availability: StockAvailability): string {
    return availability === 'AVAILABLE'
      ? 'Disponible'
      : availability === 'OUT_OF_STOCK'
        ? 'Rupture'
        : 'Non vendable';
  }

  formatStockReason(reason: StockReason | null): string {
    return reason === 'ARCHIVED'
      ? 'Article archivé'
      : reason === 'DLC_EXPIRED'
        ? 'DLC dépassée'
        : reason === 'UNSELLABLE_PACKAGING'
          ? 'Packaging invendable'
          : '—';
  }

  formatDashboardArticleType(type: DashboardArticleType): string {
    return type === 'food' ? 'Alimentaire' : 'Non alimentaire';
  }

  formatDashboardLifecycle(status: DashboardLifecycleStatus): string {
    return status === 'ACTIVE' ? 'Actif' : 'Archivé';
  }

  dashboardRowId(ean13: string): string {
    return `dashboard-row-${ean13}`;
  }

  dashboardRowHref(ean13: string): string {
    return `#${this.dashboardRowId(ean13)}`;
  }

  private async loadDashboard(): Promise<void> {
    const requestId = ++this.requestId;
    this.dashboardState.set('loading');
    this.dashboardError.set('');
    this.dashboard.set(null);

    try {
      const dashboard = await firstValueFrom(this.api.getCurrent());
      if (requestId !== this.requestId) {
        return;
      }

      this.dashboard.set(dashboard);
      this.dashboardState.set(dashboard.stockByArticle.length > 0 ? 'ready' : 'empty');
    } catch (error) {
      if (requestId !== this.requestId) {
        return;
      }

      this.dashboardState.set('error');
      this.dashboardError.set(this.problemMessage(error, 'Le Dashboard ne peut pas être chargé. Réessayez.'));
    }
  }

  private problemMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && typeof error.error === 'object' && error.error !== null) {
      const title = (error.error as { title?: unknown }).title;
      return typeof title === 'string' ? title : fallback;
    }
    return fallback;
  }
}
