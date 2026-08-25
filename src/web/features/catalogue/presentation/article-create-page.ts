import { type AfterViewInit, ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { type FieldTree, FormField, type TreeValidationResult, form, hidden, maxLength, pattern, required, submit, validate } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import type { ArticleCreateCommand } from '../application/article-create-command';
import { ArticleCreateStore } from '../application/article-create-store';
import type { ArticleType } from '../domain/article-type';
import type { Packaging } from '../domain/packaging';
import type { ConsumptionMode } from '../../../shared-kernel/consumption-mode';
import { parseEuros } from './parse-euros';

interface ArticleFormModel {
  ean13: string;
  type: ArticleType;
  name: string;
  priceHt: string;
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
  private readonly modelSignal = signal<ArticleFormModel>({ ean13: '', type: 'food', name: '', priceHt: '', dlc: '', consumptionModes: [], packaging: '' });
  readonly model = this.modelSignal.asReadonly();
  readonly modes: readonly { value: ConsumptionMode; label: string }[] = [{ value: 'takeaway', label: 'À emporter' }, { value: 'onsite', label: 'Sur place' }];
  readonly articleForm = form(this.modelSignal, (path) => {
    const ean13Message = 'L’EAN-13 doit contenir 13 chiffres.';
    required(path.ean13, { message: 'L’EAN-13 est requis.' });
    // Renders the native maxlength attribute, so the field itself refuses a 14th character.
    maxLength(path.ean13, 13, { message: ean13Message });
    pattern(path.ean13, /^\d{13}$/, { message: ean13Message });
    required(path.type);
    required(path.name, { message: 'Le nom est requis.' });
    required(path.priceHt, { message: 'Le Prix HT est requis.' });
    validate(path.priceHt, ({ value }) => parseEuros(value()) === null
      ? { kind: 'euros', message: 'Le Prix HT doit être un montant en euros, par exemple 12,50.' }
      : undefined);
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
        const priceHtCents = parseEuros(value.priceHt);
        if (priceHtCents === null) {
          restoreFocus = true;
          return { kind: 'euros', message: 'Le Prix HT doit être un montant en euros, par exemple 12,50.', fieldTree: this.articleForm.priceHt };
        }
        const base = { ean13: value.ean13, name: value.name, priceHtCents };
        const command: ArticleCreateCommand = value.type === 'food'
          ? { ...base, type: 'food', dlc: value.dlc, consumptionModes: value.consumptionModes }
          : { ...base, type: 'nonFood', packaging: value.packaging as Packaging };
        const created = await this.store.create(command);
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

  // Accepts both vocabularies: the server names the field priceHtCents, the form names it priceHt.
  private fieldFor(field: string): FieldTree<unknown> | undefined {
    if (field === 'ean13') return this.articleForm.ean13;
    if (field === 'type') return this.articleForm.type;
    if (field === 'name') return this.articleForm.name;
    if (field === 'priceHtCents' || field === 'priceHt') return this.articleForm.priceHt;
    if (field === 'dlc') return this.articleForm.dlc;
    if (field === 'consumptionModes') return this.articleForm.consumptionModes;
    if (field === 'packaging') return this.articleForm.packaging;
    return undefined;
  }

  private focusError(): void {
    const first = ['ean13', 'type', 'name', 'priceHt', 'dlc', 'consumptionModes', 'packaging'].find((field) => this.fieldFor(field)?.().errors().length);
    (first === 'consumptionModes' ? document.querySelector<HTMLElement>('#consumptionModes input') : document.getElementById(first ?? 'form-error'))?.focus();
  }
}
