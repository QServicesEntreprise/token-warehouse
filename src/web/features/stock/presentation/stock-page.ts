import { AfterViewInit, ChangeDetectionStrategy, Component, OnInit, effect, inject, signal } from '@angular/core';
import { StockPositionStore } from '../application/stock-position-store';
import { stockAvailabilityLabel } from './stock-availability-label';
import { stockNonSellableReasonLabel } from './stock-non-sellable-reason-label';

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
  readonly availabilityLabel = stockAvailabilityLabel;
  readonly reasonLabel = stockNonSellableReasonLabel;

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

}
