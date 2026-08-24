import { AfterViewInit, ChangeDetectionStrategy, Component, OnInit, effect, inject, signal } from '@angular/core';
import { StockPositionStore } from '../application/stock-position-store';
import { stockLabels } from './stock-labels';

@Component({
  selector: 'app-stock-page',
  standalone: true,
  templateUrl: './stock-page.html',
  styleUrl: './stock-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StockPage implements AfterViewInit, OnInit {
  readonly store = inject(StockPositionStore);
  private readonly filterValue = signal('');

  constructor() {
    effect(() => {
      if (this.store.detailState().status === 'ready') {
        setTimeout(() => document.getElementById('stock-detail')?.focus());
      }
    });
  }

  ngOnInit(): void {
    this.store.load();
  }

  ngAfterViewInit(): void {
    document.getElementById('stock-title')?.focus();
  }

  filter(event: Event): void {
    this.filterValue.set((event.target as HTMLInputElement).value);
    this.store.load(this.filterValue());
  }

  retry(): void {
    this.store.load(this.filterValue());
  }

  availabilityLabel(availability: keyof typeof stockLabels.availability): string {
    return stockLabels.availability[availability];
  }

  reasonLabel(reason: keyof typeof stockLabels.reason | null): string {
    return reason ? stockLabels.reason[reason] : '—';
  }
}
