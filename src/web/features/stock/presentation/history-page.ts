import { type AfterViewInit, ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import type { HistoryLoadState } from '../application/history-load-state';
import { HistoryStore } from '../application/history-store';
import { EurosPipe } from '../../../shared-kernel/euros-pipe';
import { taxRateLabel } from '../../../shared-kernel/tax-rate-label';

const historyTypeLabels: Record<string, string> = {
  supply: 'Approvisionnement',
  inventory: 'Inventaire',
  saleStock: 'Vente Stock',
  counterMovement: 'Contre-mouvement',
  catalogArchive: 'Archivage Catalogue',
  catalogReactivate: 'Réactivation Catalogue',
  catalogDlcChange: 'Changement de DLC',
  catalogPackagingChange: 'Changement de Packaging',
  catalogAttributeChange: 'Changement Catalogue',
  unknown: 'Fait historique inconnu',
};

@Component({
  selector: 'app-history-page',
  standalone: true,
  imports: [EurosPipe, RouterLink],
  templateUrl: './history-page.html',
  styleUrl: './history-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryPage implements AfterViewInit, OnInit {
  readonly store = inject(HistoryStore);
  readonly taxRateLabel = taxRateLabel;
  private readonly router = inject(Router);
  private readonly mutableFilter = signal('');
  private hasVisitedHistory = false;

  readonly filter = this.mutableFilter.asReadonly();

  constructor() {
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      takeUntilDestroyed(),
    ).subscribe((event) => {
      if (!event.urlAfterRedirects.startsWith('/stock/historique')) return;
      this.focusTitle();
      if (this.hasVisitedHistory) this.store.retry();
      this.hasVisitedHistory = true;
    });
  }

  ngOnInit(): void {
    this.store.loadGlobal();
  }

  ngAfterViewInit(): void {
    this.focusTitle();
  }

  setFilter(event: Event): void {
    this.mutableFilter.set((event.target as HTMLInputElement).value);
  }

  submit(event: Event): void {
    event.preventDefault();
    const ean13 = this.filter().trim();
    if (ean13 === '') this.loadGlobal();
    else this.store.loadArticle(ean13);
  }

  loadGlobal(): void {
    this.mutableFilter.set('');
    this.store.loadGlobal();
  }

  typeLabel(type: string): string {
    return historyTypeLabels[type] ?? 'Fait historique inconnu';
  }

  effectLabel(effect: number | null | undefined): string {
    if (effect === undefined || effect === null) return '—';
    return effect > 0 ? `+${effect}` : String(effect);
  }

  financialContextLabel(context: 'takeaway' | 'onsite' | null): string {
    return context === 'takeaway' ? 'À emporter' : context === 'onsite' ? 'Sur place' : 'Non alimentaire';
  }

  catalogChanges(entry: HistoryLoadState['entries'][number]) {
    return entry.type === 'catalogDlcChange'
      || entry.type === 'catalogPackagingChange'
      || entry.type === 'catalogAttributeChange'
      ? entry.changes.length > 0 ? entry.changes : null
      : null;
  }

  private focusTitle(): void {
    document.getElementById('history-title')?.focus();
  }
}
