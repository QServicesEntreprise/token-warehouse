import { AfterViewInit, ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FieldTree, FormField, TreeValidationResult, form, hidden, pattern, required, submit } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { ArticleCreateStore } from '../application/article-create-store';
import { ArticleType } from '../domain/article-type';
import { Packaging } from '../domain/packaging';
import { ConsumptionMode } from '../../../shared-kernel/consumption-mode';

interface ArticleFormModel {
  ean13: string;
  type: ArticleType;
  name: string;
  priceHtCents: string;
  dlc: string;
  consumptionModes: ConsumptionMode[];
  packaging: Packaging | '';
}

@Component({
  selector: 'app-article-create-page',
  standalone: true,
  imports: [FormField, RouterLink],
  templateUrl: './article-create-page.html',
  styleUrl: './article-create-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleCreatePage implements AfterViewInit {
  readonly store = inject(ArticleCreateStore);
  private readonly router = inject(Router);
  private readonly modelSignal = signal<ArticleFormModel>({ ean13: '', type: 'food', name: '', priceHtCents: '', dlc: '', consumptionModes: [], packaging: '' });
  readonly model = this.modelSignal.asReadonly();
  readonly modes: readonly { value: ConsumptionMode; label: string }[] = [{ value: 'takeaway', label: 'À emporter' }, { value: 'onsite', label: 'Sur place' }];
  readonly articleForm = form(this.modelSignal, (path) => {
    required(path.ean13, { message: 'L’EAN-13 est requis.' });
    pattern(path.ean13, /^\d{13}$/, { message: 'L’EAN-13 doit contenir 13 chiffres.' });
    required(path.type);
    required(path.name, { message: 'Le nom est requis.' });
    required(path.priceHtCents, { message: 'Le Prix HT en centimes est requis.' });
    pattern(path.priceHtCents, /^-?\d+$/, { message: 'Le Prix HT doit être un entier de centimes.' });
    required(path.dlc, { message: 'La DLC est requise.' });
    required(path.consumptionModes, { message: 'Choisissez au moins un mode.' });
    required(path.packaging, { message: 'Le Packaging est requis.' });
    hidden(path.dlc, { when: ({ valueOf }) => valueOf(path.type) !== 'food' });
    hidden(path.consumptionModes, { when: ({ valueOf }) => valueOf(path.type) !== 'food' });
    hidden(path.packaging, { when: ({ valueOf }) => valueOf(path.type) !== 'nonFood' });
  });

  ngAfterViewInit(): void {
    document.getElementById('create-title')?.focus();
  }

  toggleMode(mode: ConsumptionMode, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.modelSignal.update((value) => ({ ...value, consumptionModes: checked ? [...new Set([...value.consumptionModes, mode])] : value.consumptionModes.filter((item) => item !== mode) }));
  }

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    let restoreFocus = false;
    await submit(this.articleForm, {
      action: async () => {
        const value = this.modelSignal();
        const created = await this.store.create({
          ean13: value.ean13,
          type: value.type,
          name: value.name,
          priceHtCents: Number(value.priceHtCents),
          ...(value.type === 'food' ? { dlc: value.dlc, consumptionModes: value.consumptionModes } : { packaging: value.packaging as Packaging }),
        });
        if (created) {
          await this.router.navigate(['/catalogue', created.ean13]);
          return undefined;
        }
        restoreFocus = true;
        return this.serverErrors();
      },
      onInvalid: () => { restoreFocus = true; },
    });
    if (restoreFocus) setTimeout(() => this.focusError());
  }

  private serverErrors(): TreeValidationResult {
    const errors = Object.entries(this.store.fieldErrors()).flatMap(([field, messages]) => {
      const fieldTree = this.fieldFor(field);
      return fieldTree ? messages.map((message) => ({ kind: 'server', message, fieldTree })) : [];
    });
    return errors.length > 0 ? errors : { kind: 'server', message: this.store.error() };
  }

  private fieldFor(field: string): FieldTree<unknown> | undefined {
    if (field === 'ean13') return this.articleForm.ean13;
    if (field === 'type') return this.articleForm.type;
    if (field === 'name') return this.articleForm.name;
    if (field === 'priceHtCents') return this.articleForm.priceHtCents;
    if (field === 'dlc') return this.articleForm.dlc;
    if (field === 'consumptionModes') return this.articleForm.consumptionModes;
    if (field === 'packaging') return this.articleForm.packaging;
    return undefined;
  }

  private focusError(): void {
    const first = ['ean13', 'type', 'name', 'priceHtCents', 'dlc', 'consumptionModes', 'packaging'].find((field) => this.fieldFor(field)?.().errors().length);
    (first === 'consumptionModes' ? document.querySelector<HTMLElement>('#consumptionModes input') : document.getElementById(first ?? 'form-error'))?.focus();
  }
}
