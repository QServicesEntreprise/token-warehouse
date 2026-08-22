import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  DashboardApiService,
  DashboardArticleType,
  DashboardCalendarResponse,
  DashboardConsumptionMode,
  DashboardLifecycleStatus,
  DashboardPackaging,
  DashboardQuery,
  DashboardResponse,
  DashboardTaxRateSummaryResponse,
} from './dashboard-api.service';
import { StockAvailability, StockReason } from './stock-api.service';

type DashboardState = 'loading' | 'ready' | 'empty' | 'error';
type DashboardTypeSelection = DashboardArticleType | 'all';
type DashboardModeSelection = DashboardConsumptionMode | 'all';
type DashboardPackagingSelection = DashboardPackaging | 'all';
type DashboardFilterField = 'from' | 'to' | 'type' | 'mode' | 'packaging';
type DashboardFieldErrors = Partial<Record<DashboardFilterField, string>>;

interface DashboardFilters {
  from: string;
  to: string;
  type: DashboardTypeSelection;
  mode: DashboardModeSelection;
  packaging: DashboardPackagingSelection;
}

const initialFilters: DashboardFilters = {
  from: '',
  to: '',
  type: 'all',
  mode: 'all',
  packaging: 'all',
};

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

      <form id="dashboard-filters" class="dashboard-filters" novalidate (submit)="applyFilters($event)">
          <div>
            <label for="dashboard-from">Du</label>
            <input
              id="dashboard-from"
              type="date"
              required
              [value]="filters().from"
              [attr.aria-invalid]="dashboardFieldError('from') ? 'true' : null"
              [attr.aria-describedby]="dashboardFieldErrorId('from')"
              (change)="changeDate('from', $event)" />
            @if (dashboardFieldError('from'); as error) {
              <p id="dashboard-from-error" class="field-error">{{ error }}</p>
            }
          </div>
          <div>
            <label for="dashboard-to">Au</label>
            <input
              id="dashboard-to"
              type="date"
              required
              [value]="filters().to"
              [attr.aria-invalid]="dashboardFieldError('to') ? 'true' : null"
              [attr.aria-describedby]="dashboardFieldErrorId('to')"
              (change)="changeDate('to', $event)" />
            @if (dashboardFieldError('to'); as error) {
              <p id="dashboard-to-error" class="field-error">{{ error }}</p>
            }
          </div>
          <div>
            <label for="dashboard-type">Type d’Article</label>
            <select
              id="dashboard-type"
              [value]="filters().type"
              [attr.aria-invalid]="dashboardFieldError('type') ? 'true' : null"
              [attr.aria-describedby]="dashboardFieldErrorId('type')"
              (change)="changeType($event)">
              <option value="all">Tous</option>
              <option value="food">Alimentaire</option>
              <option value="nonFood">Non alimentaire</option>
            </select>
            @if (dashboardFieldError('type'); as error) {
              <p id="dashboard-type-error" class="field-error">{{ error }}</p>
            }
          </div>
          <div>
            <label for="dashboard-mode">Mode de consommation</label>
            <select
              id="dashboard-mode"
              [value]="filters().mode"
              [attr.aria-invalid]="dashboardFieldError('mode') ? 'true' : null"
              [attr.aria-describedby]="dashboardFieldErrorId('mode')"
              (change)="changeMode($event)">
              <option value="all">Tous</option>
              <option value="takeaway">À emporter</option>
              <option value="onsite">Sur place</option>
            </select>
            @if (dashboardFieldError('mode'); as error) {
              <p id="dashboard-mode-error" class="field-error">{{ error }}</p>
            }
          </div>
          <div>
            <label for="dashboard-packaging">Packaging</label>
            <select
              id="dashboard-packaging"
              [value]="filters().packaging"
              [attr.aria-invalid]="dashboardFieldError('packaging') ? 'true' : null"
              [attr.aria-describedby]="dashboardFieldErrorId('packaging')"
              (change)="changePackaging($event)">
              <option value="all">Tous</option>
              <option value="new">Neuf</option>
              <option value="refurbished">Reconditionné</option>
              <option value="unsellable">Invendable</option>
            </select>
            @if (dashboardFieldError('packaging'); as error) {
              <p id="dashboard-packaging-error" class="field-error">{{ error }}</p>
            }
          </div>
          <button id="dashboard-submit" type="submit" [disabled]="dashboardState() === 'loading'">
            Lire le Dashboard
          </button>
        @if (calendar(); as warehouseCalendar) {
          <p class="dashboard-calendar-note">
            Calendrier de l’Entrepôt : {{ warehouseCalendar.warehouseDate }}.
          </p>
        } @else {
          <p class="dashboard-calendar-note">
            Calendrier de l’Entrepôt indisponible pour le moment.
          </p>
        }
      </form>

      <div id="dashboard-state" class="catalog-state" aria-live="polite" role="status">
        @switch (dashboardState()) {
          @case ('loading') {
            <p>Chargement du Dashboard…</p>
          }
          @case ('ready') {
            @if ((dashboard()?.stockByArticle?.length ?? 0) > 0) {
              <p>{{ dashboard()?.stockByArticle?.length ?? 0 }} Article{{ (dashboard()?.stockByArticle?.length ?? 0) > 1 ? 's' : '' }} suivi{{ (dashboard()?.stockByArticle?.length ?? 0) > 1 ? 's' : '' }}.</p>
            } @else {
              <p>Indicateurs financiers disponibles pour la sélection.</p>
            }
          }
          @case ('empty') {
            <p>Aucun Article ne correspond aux sélections.</p>
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

        @if (current.flowsByDay.length > 0) {
          <section id="dashboard-flows" aria-labelledby="dashboard-flows-title">
            <h3 id="dashboard-flows-title">Flux quotidiens</h3>
            <p>Quantités acceptées selon le calendrier de l’Entrepôt.</p>
            <div class="table-wrap">
              <table id="dashboard-flows-table">
                <caption class="sr-only">Approvisionnements et Ventes par jour</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Approvisionnements</th>
                    <th scope="col">Ventes</th>
                  </tr>
                </thead>
                <tbody>
                @for (day of current.flowsByDay; track day.date) {
                    <tr>
                      <th scope="row">{{ day.date }}</th>
                      <td>{{ day.supplies }} unité{{ day.supplies > 1 ? 's' : '' }}</td>
                      <td>{{ day.sales }} unité{{ day.sales > 1 ? 's' : '' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }

        @if (current.financial; as financial) {
        <section id="dashboard-financial" aria-labelledby="dashboard-financial-title">
          <h3 id="dashboard-financial-title">Indicateurs financiers</h3>
          <p>Montants historiques fournis par les Ventes validées, en euros.</p>
          <div class="dashboard-financial-kpis" aria-label="Résumé financier">
            <article id="dashboard-financial-revenue-ht" class="dashboard-kpi">
              <h4>Chiffre d’affaires HT</h4>
              <p>{{ formatFinancialCents(financial.revenueHtCents) }}</p>
            </article>
            <article id="dashboard-financial-revenue-ttc" class="dashboard-kpi">
              <h4>Chiffre d’affaires TTC</h4>
              <p>{{ formatFinancialCents(financial.revenueTtcCents) }}</p>
            </article>
            <article id="dashboard-financial-vat" class="dashboard-kpi">
              <h4>TVA collectée</h4>
              <p>{{ formatFinancialCents(financial.vatCollectedCents) }}</p>
            </article>
          </div>
          <div class="table-wrap">
            <table id="dashboard-financial-table">
              <caption class="sr-only">TVA collectée et montants par taux</caption>
              <thead>
                <tr>
                  <th scope="col">Taux de TVA</th>
                  <th scope="col">Montant HT</th>
                  <th scope="col">TVA</th>
                  <th scope="col">Montant TTC</th>
                </tr>
              </thead>
              <tbody>
                @for (line of financial.byTaxRate; track line.taxRate.code) {
                  <tr>
                    <th scope="row">{{ formatTaxRate(line) }}</th>
                    <td>{{ formatFinancialCents(line.amountHtCents) }}</td>
                    <td>{{ formatFinancialCents(line.vatCents) }}</td>
                    <td>{{ formatFinancialCents(line.amountTtcCents) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
        }

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

  readonly calendar = signal<DashboardCalendarResponse | null>(null);
  readonly filters = signal<DashboardFilters>({ ...initialFilters });
  readonly dashboard = signal<DashboardResponse | null>(null);
  readonly dashboardState = signal<DashboardState>('loading');
  readonly dashboardError = signal('');
  readonly dashboardFieldErrors = signal<DashboardFieldErrors>({});

  private requestId = 0;

  ngOnInit(): void {
    void this.loadDashboard();
  }

  applyFilters(event: Event): void {
    event.preventDefault();
    const query = this.toQuery();
    if (query === null) {
      const errors: DashboardFieldErrors = {};
      if (!this.filters().from) {
        errors.from = 'La date de début est requise.';
      }
      if (!this.filters().to) {
        errors.to = 'La date de fin est requise.';
      }
      this.dashboard.set(null);
      this.dashboardState.set('error');
      this.dashboardError.set('Corrigez la période sélectionnée.');
      this.dashboardFieldErrors.set(errors);
      this.focusDashboardField(errors);
      return;
    }

    void this.loadDashboard(query);
  }

  retryDashboard(): void {
    const query = this.toQuery();
    void this.loadDashboard(query ?? undefined);
  }

  changeDate(field: 'from' | 'to', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.filters.update(current => ({ ...current, [field]: value }));
  }

  changeType(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const type: DashboardTypeSelection = value === 'food' || value === 'nonFood' ? value : 'all';
    this.filters.update(current => ({
      ...current,
      type,
    }));
  }

  changeMode(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.filters.update(current => ({
      ...current,
      mode: value === 'takeaway' || value === 'onsite' ? value : 'all',
    }));
  }

  changePackaging(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.filters.update(current => ({
      ...current,
      packaging: value === 'new' || value === 'refurbished' || value === 'unsellable' ? value : 'all',
    }));
  }

  dashboardFieldError(field: DashboardFilterField): string | null {
    return this.dashboardFieldErrors()[field] ?? null;
  }

  dashboardFieldErrorId(field: DashboardFilterField): string | null {
    return this.dashboardFieldError(field) === null ? null : `dashboard-${field}-error`;
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

  formatFinancialCents(cents: number): string {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  }

  formatTaxRate(line: DashboardTaxRateSummaryResponse): string {
    return line.taxRate.code === 'takeaway'
      ? '5,5 %'
      : line.taxRate.code === 'onsite'
        ? '10 %'
        : '20 %';
  }

  dashboardRowId(ean13: string): string {
    return `dashboard-row-${ean13}`;
  }

  dashboardRowHref(ean13: string): string {
    return `#${this.dashboardRowId(ean13)}`;
  }

  private async loadDashboard(query?: DashboardQuery): Promise<void> {
    const requestId = ++this.requestId;
    this.dashboardState.set('loading');
    this.dashboardError.set('');
    this.dashboardFieldErrors.set({});
    this.dashboard.set(null);

    try {
      if (this.calendar() === null) {
        const calendar = await firstValueFrom(this.api.getCalendar());
        if (requestId !== this.requestId) {
          return;
        }

        this.calendar.set(calendar);
        this.filters.update(current => ({
          ...current,
          from: current.from || calendar.currentMonth.from,
          to: current.to || calendar.currentMonth.to,
        }));
      }

      const currentQuery = query ?? this.toQuery();
      if (currentQuery === null) {
        this.dashboardState.set('error');
        this.dashboardError.set('La période du Dashboard est indisponible.');
        return;
      }

      const dashboard = await firstValueFrom(this.api.getCurrent(currentQuery));
      if (requestId !== this.requestId) {
        return;
      }

      this.dashboard.set(dashboard);
      this.dashboardState.set(
        dashboard.stockByArticle.length > 0 || Boolean(dashboard.financial) ? 'ready' : 'empty');
    } catch (error) {
      if (requestId !== this.requestId) {
        return;
      }

      this.dashboardState.set('error');
      this.dashboardError.set(this.problemMessage(error, 'Le Dashboard ne peut pas être chargé. Réessayez.'));
      const fieldErrors = this.problemFieldErrors(error);
      this.dashboardFieldErrors.set(fieldErrors);
      this.focusDashboardField(fieldErrors);
    }
  }

  private toQuery(): DashboardQuery | null {
    const filters = this.filters();
    if (!filters.from || !filters.to) {
      return null;
    }

    return {
      from: filters.from,
      to: filters.to,
      type: filters.type === 'all' ? null : filters.type,
      mode: filters.mode === 'all' ? null : filters.mode,
      packaging: filters.packaging === 'all' ? null : filters.packaging,
    };
  }

  private problemMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && typeof error.error === 'object' && error.error !== null) {
      const title = (error.error as { title?: unknown }).title;
      return typeof title === 'string' ? title : fallback;
    }
    return fallback;
  }

  private problemFieldErrors(error: unknown): DashboardFieldErrors {
    if (!(error instanceof HttpErrorResponse) || typeof error.error !== 'object' || error.error === null) {
      return {};
    }

    const errors = (error.error as { errors?: unknown }).errors;
    if (typeof errors !== 'object' || errors === null) {
      return {};
    }

    const result: DashboardFieldErrors = {};
    for (const [field, messages] of Object.entries(errors)) {
      if (field !== 'from' && field !== 'to' && field !== 'type' && field !== 'mode' && field !== 'packaging') {
        continue;
      }

      result[field] = Array.isArray(messages) && typeof messages[0] === 'string'
        ? messages[0]
        : 'Valeur invalide.';
    }
    return result;
  }

  private focusDashboardField(errors: DashboardFieldErrors): void {
    const field = (['from', 'to', 'type', 'mode', 'packaging'] as const)
      .find(candidate => errors[candidate]);
    if (field) {
      document.getElementById(`dashboard-${field}`)?.focus();
    }
  }
}
