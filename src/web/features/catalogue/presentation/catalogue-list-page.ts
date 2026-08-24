import { AfterViewInit, ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { CatalogueListStore } from '../application/catalogue-list-store';
import { CatalogueQuery } from '../application/catalogue-query';
import { ArticleSummary } from '../domain/article-summary';
import { ArticleType } from '../domain/article-type';
import { ArticleStatusFilter } from '../domain/article-status-filter';
import { Packaging } from '../domain/packaging';
import { ConsumptionMode } from '../../../shared-kernel/consumption-mode';

@Component({
  selector: 'app-catalogue-list-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './catalogue-list-page.html',
  styleUrl: './catalogue-list-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogueListPage implements OnInit, AfterViewInit {
  readonly store = inject(CatalogueListStore);
  private readonly searchSignal = signal('');
  private readonly statusSignal = signal<ArticleStatusFilter>('active');
  private readonly typeSignal = signal<ArticleType | 'all'>('all');
  private readonly modeSignal = signal<ConsumptionMode | ''>('');
  private readonly packagingSignal = signal<Packaging | ''>('');

  readonly search = this.searchSignal.asReadonly();
  readonly status = this.statusSignal.asReadonly();
  readonly type = this.typeSignal.asReadonly();
  readonly mode = this.modeSignal.asReadonly();
  readonly packaging = this.packagingSignal.asReadonly();

  constructor() {
    inject(Router).events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      filter((event) => event.urlAfterRedirects.split('?')[0] === '/catalogue'),
      takeUntilDestroyed(),
    ).subscribe(() => setTimeout(() => document.getElementById('catalog-title')?.focus()));
  }

  ngOnInit(): void {
    this.load();
  }

  ngAfterViewInit(): void {
    document.getElementById('catalog-title')?.focus();
  }

  setSearch(event: Event): void {
    this.searchSignal.set((event.target as HTMLInputElement).value);
  }

  setStatus(event: Event): void {
    this.statusSignal.set((event.target as HTMLSelectElement).value as ArticleStatusFilter);
  }

  setType(event: Event): void {
    const type = (event.target as HTMLSelectElement).value as ArticleType | 'all';
    this.typeSignal.set(type);
    if (type === 'food') this.packagingSignal.set('');
    if (type === 'nonFood') this.modeSignal.set('');
  }

  setMode(event: Event): void {
    this.modeSignal.set((event.target as HTMLSelectElement).value as ConsumptionMode | '');
  }

  setPackaging(event: Event): void {
    this.packagingSignal.set((event.target as HTMLSelectElement).value as Packaging | '');
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    this.load();
  }

  load(): void {
    const query: CatalogueQuery = { status: this.statusSignal() };
    const search = this.searchSignal().trim();
    if (search) query.search = search;
    if (this.typeSignal() !== 'all') query.type = this.typeSignal() as ArticleType;
    if (this.modeSignal()) query.mode = this.modeSignal() as ConsumptionMode;
    if (this.packagingSignal()) query.packaging = this.packagingSignal() as Packaging;
    this.store.search(query);
  }

  async toggleLifecycle(article: ArticleSummary): Promise<void> {
    const focused = document.activeElement as HTMLElement | null;
    await this.store.toggleLifecycle(article);
    setTimeout(() => {
      if (focused?.isConnected) focused.focus();
      else document.getElementById('catalog-lifecycle-status')?.focus();
    });
  }

  isActive(article: ArticleSummary): boolean {
    return article.status === 'active';
  }

  formatModes(modes: ConsumptionMode[]): string {
    return modes.map((mode) => mode === 'takeaway' ? 'À emporter' : 'Sur place').join(', ');
  }

  formatPackaging(packaging: Packaging | undefined): string {
    return packaging === 'new' ? 'Neuf'
      : packaging === 'refurbished' ? 'Reconditionné'
        : packaging === 'unsellable' ? 'Invendable' : '—';
  }
}
