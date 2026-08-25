import { type AfterViewInit, ChangeDetectionStrategy, Component, type OnInit, computed, effect, inject } from '@angular/core';
import { DashboardStore } from '../application/dashboard-store';
import { EurosPipe } from '../../../shared-kernel/euros-pipe';
import type { DashboardFilter } from '../domain/dashboard-filter';
import type { DashboardStockLine } from '../domain/dashboard-stock-line';
import type { DashboardTaxSummary } from '../domain/dashboard-tax-summary';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [EurosPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.css',
})
export class DashboardPage implements OnInit, AfterViewInit {
  protected readonly store = inject(DashboardStore);
  protected readonly articleCount = computed(() => this.store.dashboard()?.stockByArticle.length ?? 0);

  constructor() {
    effect(() => {
      if (this.store.state() !== 'error') return;
      const errors = this.store.fieldErrors();
      const field = (['from', 'to', 'type', 'mode', 'packaging'] as const)
        .find(candidate => errors[candidate]);
      if (field) queueMicrotask(() => document.getElementById(`dashboard-${field}`)?.focus());
    });
  }

  ngOnInit(): void {
    this.store.load();
  }

  ngAfterViewInit(): void {
    const title = document.getElementById('dashboard-title');
    if (title) {
      title.focus({ preventScroll: true });
      title.scrollIntoView?.();
    }
  }

  protected applyFilters(event: Event): void {
    event.preventDefault();
    this.store.read();
  }

  protected retryDashboard(): void {
    this.store.retry();
  }

  protected changeDate(field: 'from' | 'to', event: Event): void {
    this.store.setFilter(field, (event.target as HTMLInputElement).value);
  }

  protected changeType(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.store.setFilter('type', value === 'food' || value === 'nonFood' ? value : null);
  }

  protected changeMode(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.store.setFilter('mode', value === 'takeaway' || value === 'onsite' ? value : null);
  }

  protected changePackaging(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.store.setFilter(
      'packaging',
      value === 'new' || value === 'refurbished' || value === 'unsellable' ? value : null,
    );
  }

  protected fieldError(field: keyof DashboardFilter): string | null {
    return this.store.fieldErrors()[field] ?? null;
  }

  protected fieldErrorId(field: keyof DashboardFilter): string | null {
    return this.fieldError(field) === null ? null : `dashboard-${field}-error`;
  }

  protected formatStockAvailability(availability: DashboardStockLine['availability']): string {
    return availability === 'AVAILABLE'
      ? 'Disponible'
      : availability === 'OUT_OF_STOCK'
        ? 'Rupture'
        : 'Non vendable';
  }

  protected formatStockReason(reason: DashboardStockLine['reason']): string {
    return reason === 'ARCHIVED'
      ? 'Article archivé'
      : reason === 'DLC_EXPIRED'
        ? 'DLC dépassée'
        : reason === 'UNSELLABLE_PACKAGING'
          ? 'Packaging invendable'
          : '—';
  }

  protected formatArticleType(type: DashboardStockLine['articleType']): string {
    return type === 'food' ? 'Alimentaire' : 'Non alimentaire';
  }

  protected formatLifecycle(status: DashboardStockLine['lifecycleStatus']): string {
    return status === 'ACTIVE' ? 'Actif' : 'Archivé';
  }

  protected formatTaxRate(line: DashboardTaxSummary): string {
    return line.taxRate.code === 'takeaway'
      ? '5,5 %'
      : line.taxRate.code === 'onsite'
        ? '10 %'
        : '20 %';
  }

  protected rowId(ean13: string): string {
    return `dashboard-row-${ean13}`;
  }

  protected rowHref(ean13: string): string {
    return `/dashboard#${this.rowId(ean13)}`;
  }
}
