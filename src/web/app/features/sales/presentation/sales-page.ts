import { AfterViewInit, ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, required, submit, validate } from '@angular/forms/signals';
import { SaleStore } from '../application/sale-store';
import { SaleCommand } from '../domain/sale-command';
import { SaleContext } from '../domain/sale-context';
import { SellableArticle } from '../domain/sellable-article';

interface SaleFormModel {
  quantity: string;
  context: SaleContext | '';
}

@Component({
  selector: 'app-sales-page',
  standalone: true,
  imports: [FormField, FormRoot],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sales-page.html',
  styleUrl: './sales-page.css',
})
export class SalesPage implements AfterViewInit, OnInit {
  readonly store = inject(SaleStore);
  private readonly searchState = signal('');
  private readonly clientStatusState = signal('');
  private readonly saleModelState = signal<SaleFormModel>({ quantity: '', context: '' });
  readonly search = this.searchState.asReadonly();
  readonly clientStatus = this.clientStatusState.asReadonly();
  readonly saleModel = this.saleModelState.asReadonly();
  readonly requiresContext = computed(() => {
    const article = this.store.selectedArticle();
    return article?.type === 'food' && (article.consumptionModes?.length ?? 0) > 1;
  });
  readonly saleForm = form(this.saleModelState, (path) => {
    required(path.quantity, { message: 'La quantité est requise.' });
    validate(path.quantity, ({ value }) => {
      const raw = value().trim();
      const quantity = Number(raw);
      return /^\d+$/.test(raw) && Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 2_147_483_647
        ? undefined
        : { kind: 'quantity', message: 'La quantité doit être un entier strictement positif.' };
    });
    required(path.context, {
      when: () => this.requiresContext(),
      message: 'Choisissez un Contexte de Vente.',
    });
  });

  ngOnInit(): void {
    void this.restoreLastSale();
  }

  ngAfterViewInit(): void {
    const title = document.getElementById('sale-title');
    if (title) {
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
      title.scrollIntoView?.();
    }
  }

  setSearch(event: Event): void {
    this.searchState.set((event.target as HTMLInputElement).value);
  }

  onSearchSubmit(event: Event): void {
    event.preventDefault();
    this.searchArticles();
  }

  searchArticles(search = this.search()): void {
    this.searchState.set(search);
    this.clientStatusState.set('');
    this.store.search(this.search());
  }

  selectArticle(article: SellableArticle): void {
    this.store.selectArticle(article);
    const modes = article.consumptionModes ?? [];
    this.saleModelState.update((model) => ({
      ...model,
      context: article.type === 'food' && modes.length === 1 ? modes[0] : '',
    }));
    this.clientStatusState.set('');
  }

  async onSaleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.clientStatusState.set('');
    let succeeded = false;
    let superseded = false;
    await submit(this.saleForm, {
      action: async () => {
        const article = this.store.selectedArticle();
        if (!article) {
          this.clientStatusState.set('Sélectionnez un Article avant de valider la Vente.');
          return undefined;
        }
        const model = this.saleModel();
        const command: SaleCommand = { ean13: article.ean13, quantity: Number(model.quantity) };
        if (article.type === 'food' && model.context) {
          command.context = model.context;
        }
        succeeded = await this.store.record(command);
        superseded = !succeeded && this.store.selectedArticle()?.ean13 !== article.ean13;
        return undefined;
      },
      onInvalid: () => {
        this.clientStatusState.set(this.requiresContext() && !this.saleModel().context
          ? 'Choisissez un Contexte de Vente avant de continuer.'
          : 'Corrigez la quantité avant de continuer.');
      },
    });

    if (succeeded) {
      const receipt = this.store.receipt();
      if (receipt) {
        this.saleModelState.update((model) => ({ ...model, context: receipt.financial.context ?? '' }));
      }
      setTimeout(() => document.getElementById('sale-result')?.focus());
    } else if (!superseded) {
      setTimeout(() => this.focusError());
    }
  }

  fieldError(field: 'quantity' | 'context'): string {
    const serverError = this.store.fieldErrors()[field];
    if (serverError) {
      return serverError;
    }
    const control = this.saleForm[field];
    return control().touched() ? control().errors()[0]?.message ?? '' : '';
  }

  formatAvailability(availability: SellableArticle['availability']): string {
    return availability === 'AVAILABLE'
      ? 'Disponible'
      : availability === 'OUT_OF_STOCK'
        ? 'Rupture'
        : 'Non vendable';
  }

  private async restoreLastSale(): Promise<void> {
    await this.store.restore();
    const receipt = this.store.receipt();
    const article = this.store.selectedArticle();
    if (receipt && article) {
      this.saleModelState.set({
        quantity: String(receipt.operation.quantity),
        context: receipt.financial.context ?? '',
      });
    }
  }

  private focusError(): void {
    const target = this.fieldError('quantity')
      ? document.getElementById('sale-quantity')
      : this.fieldError('context')
        ? document.querySelector<HTMLElement>('#sale-context input')
        : document.getElementById('sale-status');
    target?.focus();
  }
}
