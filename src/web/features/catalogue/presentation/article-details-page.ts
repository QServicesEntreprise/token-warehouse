import { AfterViewInit, ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FieldTree, FormField, TreeValidationResult, form, hidden, pattern, required, submit } from '@angular/forms/signals';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';
import { ArticleDetailsStore } from '../application/article-details-store';
import { ArticleType } from '../domain/article-type';
import { Packaging } from '../domain/packaging';
import { ConsumptionMode } from '../../../shared-kernel/consumption-mode';

interface AttributeFormModel {
  type: ArticleType;
  name: string;
  dlc: string;
  consumptionModes: ConsumptionMode[];
  packaging: Packaging | '';
}

interface PriceFormModel {
  priceHtCents: string;
}

@Component({
  selector: 'app-article-details-page',
  standalone: true,
  imports: [FormField, RouterLink],
  templateUrl: './article-details-page.html',
  styleUrl: './article-details-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleDetailsPage implements AfterViewInit {
  readonly store = inject(ArticleDetailsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly attributeModelSignal = signal<AttributeFormModel>({ type: 'food', name: '', dlc: '', consumptionModes: [], packaging: '' });
  private readonly priceModelSignal = signal<PriceFormModel>({ priceHtCents: '' });
  readonly attributeModel = this.attributeModelSignal.asReadonly();
  readonly modes: readonly { value: ConsumptionMode; label: string }[] = [{ value: 'takeaway', label: 'À emporter' }, { value: 'onsite', label: 'Sur place' }];
  readonly attributeForm = form(this.attributeModelSignal, (path) => {
    required(path.name, { message: 'Le nom est requis.' });
    required(path.dlc, { message: 'La DLC est requise.' });
    required(path.consumptionModes, { message: 'Choisissez au moins un mode.' });
    required(path.packaging, { message: 'Le Packaging est requis.' });
    hidden(path.dlc, { when: ({ valueOf }) => valueOf(path.type) !== 'food' });
    hidden(path.consumptionModes, { when: ({ valueOf }) => valueOf(path.type) !== 'food' });
    hidden(path.packaging, { when: ({ valueOf }) => valueOf(path.type) !== 'nonFood' });
  });
  readonly priceForm = form(this.priceModelSignal, (path) => {
    required(path.priceHtCents, { message: 'Le Prix HT en centimes est requis.' });
    pattern(path.priceHtCents, /^-?\d+$/, { message: 'Le Prix HT doit être un entier de centimes.' });
  });

  constructor() {
    this.route.paramMap.pipe(
      map((params) => params.get('ean13') ?? ''),
      distinctUntilChanged(),
      takeUntilDestroyed(),
    ).subscribe((ean13) => this.store.load(ean13));
    effect(() => {
      const article = this.store.article();
      if (!article) return;
      this.attributeModelSignal.set({
        type: article.type,
        name: article.name,
        dlc: article.dlc ?? '',
        consumptionModes: [...(article.consumptionModes ?? [])],
        packaging: article.packaging ?? '',
      });
      this.priceModelSignal.set({ priceHtCents: String(article.priceHtCents) });
    });
  }

  ngAfterViewInit(): void {
    document.getElementById('article-details-title')?.focus();
  }

  toggleMode(mode: ConsumptionMode, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.attributeModelSignal.update((value) => ({ ...value, consumptionModes: checked ? [...new Set([...value.consumptionModes, mode])] : value.consumptionModes.filter((item) => item !== mode) }));
  }

  fieldError(field: string): string {
    return this.store.fieldErrors()[field]?.[0] ?? '';
  }

  async onAttributeSubmit(event: Event): Promise<void> {
    event.preventDefault();
    let restoreFocus = false;
    await submit(this.attributeForm, {
      action: async () => {
        const value = this.attributeModelSignal();
        const updated = await this.store.updateAttributes(value.type === 'food'
          ? { name: value.name, dlc: value.dlc, consumptionModes: value.consumptionModes }
          : { name: value.name, packaging: value.packaging as Packaging });
        if (updated) return undefined;
        restoreFocus = true;
        return this.serverErrors('attributes');
      },
      onInvalid: () => { restoreFocus = true; },
    });
    if (restoreFocus) setTimeout(() => this.focusAttributeError());
  }

  async onPriceSubmit(event: Event): Promise<void> {
    event.preventDefault();
    let restoreFocus = false;
    await submit(this.priceForm, {
      action: async () => {
        const updated = await this.store.updatePrice(Number(this.priceModelSignal().priceHtCents));
        if (updated) return undefined;
        restoreFocus = true;
        return this.serverErrors('price');
      },
      onInvalid: () => { restoreFocus = true; },
    });
    if (restoreFocus) setTimeout(() => document.getElementById('detailPriceHtCents')?.focus());
  }

  async toggleLifecycle(): Promise<void> {
    const button = document.getElementById('detail-lifecycle-action');
    await this.store.toggleLifecycle();
    setTimeout(() => (button?.isConnected ? button : document.getElementById('catalog-lifecycle-status'))?.focus());
  }

  private serverErrors(form: 'attributes' | 'price'): TreeValidationResult {
    const errors = Object.entries(this.store.fieldErrors()).flatMap(([field, messages]) => {
      const fieldTree = form === 'price' ? this.priceField(field) : this.attributeField(field);
      return fieldTree ? messages.map((message) => ({ kind: 'server', message, fieldTree })) : [];
    });
    return errors.length > 0 ? errors : { kind: 'server', message: this.store.error() };
  }

  private priceField(field: string): FieldTree<unknown> | undefined {
    return field === 'priceHtCents' ? this.priceForm.priceHtCents : undefined;
  }

  private attributeField(field: string): FieldTree<unknown> | undefined {
    if (field === 'name') return this.attributeForm.name;
    if (field === 'dlc') return this.attributeForm.dlc;
    if (field === 'consumptionModes') return this.attributeForm.consumptionModes;
    if (field === 'packaging') return this.attributeForm.packaging;
    return undefined;
  }

  private focusAttributeError(): void {
    const field = Object.keys(this.store.fieldErrors())[0];
    const target = field === 'consumptionModes' ? document.querySelector<HTMLElement>('#detailConsumptionModes input')
      : document.getElementById(field === 'name' ? 'detailName' : field === 'dlc' ? 'detailDlc' : field === 'packaging' ? 'detailPackaging' : 'attribute-update-error');
    target?.focus();
  }
}
