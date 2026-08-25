import { type AfterViewInit, ChangeDetectionStrategy, Component, inject, linkedSignal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { type FieldTree, FormField, type TreeValidationResult, form, hidden, pattern, required, submit } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';
import { ArticleDetailsStore } from '../application/article-details-store';
import type { ArticleType } from '../domain/article-type';
import type { Packaging } from '../domain/packaging';
import type { ConsumptionMode } from '../../../shared-kernel/consumption-mode';

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
  private readonly router = inject(Router);
  private readonly lookupEan13Signal = signal('');
  private detailLoadId = 0;
  private readonly attributeModelSignal = linkedSignal<AttributeFormModel>(() => {
    const article = this.store.article();
    return article ? {
      type: article.type,
      name: article.name,
      dlc: article.dlc ?? '',
      consumptionModes: [...(article.consumptionModes ?? [])],
      packaging: article.packaging ?? '',
    } : { type: 'food', name: '', dlc: '', consumptionModes: [], packaging: '' };
  });
  private readonly priceModelSignal = linkedSignal<PriceFormModel>(() => {
    const article = this.store.article();
    return { priceHtCents: article ? String(article.priceHtCents) : '' };
  });
  readonly attributeModel = this.attributeModelSignal.asReadonly();
  readonly lookupEan13 = this.lookupEan13Signal.asReadonly();
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
    ).subscribe((ean13) => {
      this.detailLoadId += 1;
      this.lookupEan13Signal.set(ean13);
      this.attributeForm().reset({ type: 'food', name: '', dlc: '', consumptionModes: [], packaging: '' });
      this.priceForm().reset({ priceHtCents: '' });
      this.store.load(ean13);
    });
  }

  ngAfterViewInit(): void {
    document.getElementById('article-details-title')?.focus();
  }

  setLookupEan13(event: Event): void {
    this.lookupEan13Signal.set((event.target as HTMLInputElement).value);
  }

  async onLookupSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const ean13 = this.lookupEan13Signal().trim();
    if (ean13) await this.router.navigate(['/catalogue', ean13]);
  }

  toggleMode(mode: ConsumptionMode, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.attributeModelSignal.update((value) => ({ ...value, consumptionModes: checked ? [...new Set([...value.consumptionModes, mode])] : value.consumptionModes.filter((item) => item !== mode) }));
  }

  fieldError(field: string): string {
    return (this.attributeField(field) ?? this.priceField(field))?.().errors()[0]?.message
      ?? this.store.fieldErrors()[field]?.[0]
      ?? '';
  }

  async onAttributeSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const detailLoadId = this.detailLoadId;
    let restoreFocus = false;
    await submit(this.attributeForm, {
      action: async () => {
        const value = this.attributeModelSignal();
        const updated = await this.store.updateAttributes(value.type === 'food'
          ? { name: value.name, dlc: value.dlc, consumptionModes: value.consumptionModes }
          : { name: value.name, packaging: value.packaging as Packaging });
        if (updated || this.detailLoadId !== detailLoadId) return undefined;
        restoreFocus = true;
        return this.serverErrors('attributes');
      },
      onInvalid: () => { restoreFocus = true; },
    });
    if (restoreFocus) setTimeout(() => this.focusAttributeError());
  }

  async onPriceSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const detailLoadId = this.detailLoadId;
    let restoreFocus = false;
    await submit(this.priceForm, {
      action: async () => {
        const updated = await this.store.updatePrice(Number(this.priceModelSignal().priceHtCents));
        if (updated || this.detailLoadId !== detailLoadId) return undefined;
        restoreFocus = true;
        return this.serverErrors('price');
      },
      onInvalid: () => { restoreFocus = true; },
    });
    if (restoreFocus) setTimeout(() => document.getElementById('detailPriceHtCents')?.focus());
  }

  async toggleLifecycle(): Promise<void> {
    const button = document.getElementById('detail-lifecycle-action');
    const detailLoadId = this.detailLoadId;
    await this.store.toggleLifecycle();
    if (this.detailLoadId !== detailLoadId) return;
    setTimeout(() => { if (button?.isConnected) button.focus(); });
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
    const field = ['name', 'dlc', 'consumptionModes', 'packaging']
      .find((candidate) => this.attributeField(candidate)?.().errors().length);
    const target = field === 'consumptionModes' ? document.querySelector<HTMLElement>('#detailConsumptionModes input')
      : document.getElementById(field === 'name' ? 'detailName' : field === 'dlc' ? 'detailDlc' : field === 'packaging' ? 'detailPackaging' : 'attribute-update-error');
    target?.focus();
  }
}
