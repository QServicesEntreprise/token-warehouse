import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  FieldTree,
  FormField,
  TreeValidationResult,
  form,
  hidden,
  pattern,
  required,
  submit,
} from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import {
  ArticleApiService,
  ArticleCreatePayload,
  ArticleResponse,
  ArticleType,
  ConsumptionMode,
  Packaging,
  ProblemDetails,
} from './article-api.service';

interface ArticleFormModel {
  ean13: string;
  type: ArticleType;
  name: string;
  priceHtCents: string;
  dlc: string;
  consumptionModes: ConsumptionMode[];
  packaging: Packaging | '';
}

const initialModel: ArticleFormModel = {
  ean13: '',
  type: 'food',
  name: '',
  priceHtCents: '',
  dlc: '',
  consumptionModes: [],
  packaging: '',
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main aria-labelledby="page-title">
      <header class="page-header">
        <p class="eyebrow">Catalogue d’Articles</p>
        <h1 id="page-title">Créer et consulter un Article</h1>
        <p>Une référence EAN-13, un Prix HT en centimes et les attributs de sa classification.</p>
      </header>

      <section class="panel" aria-labelledby="create-title">
        <h2 id="create-title">Nouvel Article</h2>
        <p id="form-error" class="form-error" aria-live="assertive" tabindex="-1">{{ formError() }}</p>

        <form novalidate (submit)="onSubmit($event)">
          <div class="form-grid">
            <label>
              EAN-13
              <input id="ean13" autocomplete="off" inputmode="numeric" [formField]="articleForm.ean13" aria-describedby="ean13-error" />
              @if (articleForm.ean13().errors().length > 0) {
                <span id="ean13-error" class="field-error">{{ articleForm.ean13().errors()[0].message }}</span>
              }
            </label>

            <label>
              Type
              <select id="type" [formField]="articleForm.type">
                <option value="food">Alimentaire</option>
                <option value="nonFood">Non alimentaire</option>
              </select>
            </label>

            <label>
              Nom
              <input id="name" autocomplete="off" [formField]="articleForm.name" aria-describedby="name-error" />
              @if (articleForm.name().errors().length > 0) {
                <span id="name-error" class="field-error">{{ articleForm.name().errors()[0].message }}</span>
              }
            </label>

            <label>
              Prix HT (centimes)
              <input id="priceHtCents" type="number" step="1" inputmode="numeric" [formField]="articleForm.priceHtCents" aria-describedby="price-error" />
              @if (articleForm.priceHtCents().errors().length > 0) {
                <span id="price-error" class="field-error">{{ articleForm.priceHtCents().errors()[0].message }}</span>
              }
            </label>

            @if (model().type === 'food') {
              <label>
                DLC
                <input id="dlc" type="date" [formField]="articleForm.dlc" aria-describedby="dlc-error" />
                @if (articleForm.dlc().errors().length > 0) {
                  <span id="dlc-error" class="field-error">{{ articleForm.dlc().errors()[0].message }}</span>
                }
              </label>

              <fieldset id="consumptionModes" aria-describedby="consumptionModes-error">
                <legend>Modes de consommation</legend>
                @for (mode of consumptionModeOptions; track mode.value) {
                  <label class="choice">
                    <input
                      type="checkbox"
                      [checked]="model().consumptionModes.includes(mode.value)"
                      (change)="toggleMode(mode.value, $event)" />
                    {{ mode.label }}
                  </label>
                }
                @if (articleForm.consumptionModes().errors().length > 0) {
                  <span id="consumptionModes-error" class="field-error">{{ articleForm.consumptionModes().errors()[0].message }}</span>
                }
              </fieldset>
            }

            @if (model().type === 'nonFood') {
              <label>
                Packaging
                <select id="packaging" [formField]="articleForm.packaging" aria-describedby="packaging-error">
                  <option value="">Sélectionner</option>
                  <option value="new">Neuf</option>
                  <option value="refurbished">Reconditionné</option>
                  <option value="unsellable">Invendable</option>
                </select>
                @if (articleForm.packaging().errors().length > 0) {
                  <span id="packaging-error" class="field-error">{{ articleForm.packaging().errors()[0].message }}</span>
                }
              </label>
            }
          </div>

          <button type="submit" [disabled]="submitting()">{{ submitting() ? 'Enregistrement…' : 'Créer l’Article' }}</button>
        </form>
      </section>

      <section class="panel" aria-labelledby="lookup-title">
        <h2 id="lookup-title">Consulter par EAN-13</h2>
        <form class="lookup" (submit)="onLookup($event)">
          <label>
            EAN-13 à consulter
            <input id="lookupEan13" inputmode="numeric" [value]="lookupEan()" (input)="setLookupEan($event)" />
          </label>
          <button type="submit" [disabled]="lookingUp()">Consulter</button>
        </form>
        <p id="lookup-error" class="form-error" aria-live="polite">{{ lookupError() }}</p>

        @if (detail(); as article) {
          <article class="article-detail" aria-labelledby="detail-title">
            <h3 id="detail-title">{{ article.name }}</h3>
            <dl>
              <div><dt>EAN-13</dt><dd>{{ article.ean13 }}</dd></div>
              <div><dt>Type</dt><dd>{{ article.type === 'food' ? 'Alimentaire' : 'Non alimentaire' }}</dd></div>
              <div><dt>Prix HT</dt><dd>{{ article.priceHtCents }} centimes</dd></div>
              <div><dt>Statut</dt><dd>{{ article.isActive ? 'Actif' : 'Inactif' }}</dd></div>
              @if (article.dlc) {
                <div><dt>DLC</dt><dd>{{ article.dlc }}</dd></div>
              }
              @if (article.consumptionModes) {
                <div><dt>Modes</dt><dd>{{ article.consumptionModes.join(', ') }}</dd></div>
              }
              @if (article.packaging) {
                <div><dt>Packaging</dt><dd>{{ article.packaging }}</dd></div>
              }
            </dl>

            <form id="price-update-form" (submit)="onPriceUpdate($event)" aria-labelledby="price-update-title">
              <h4 id="price-update-title">Prix de référence</h4>
              <label>
                Prix HT (centimes)
                <input
                  id="detailPriceHtCents"
                  type="number"
                  step="1"
                  inputmode="numeric"
                  [value]="priceHtDraft()"
                  [attr.aria-invalid]="priceHtFieldError() ? 'true' : null"
                  aria-describedby="priceHt-update-error"
                  (input)="setPriceHtDraft($event)" />
                @if (priceHtFieldError()) {
                  <span id="priceHt-update-error" class="field-error">{{ priceHtFieldError() }}</span>
                }
              </label>
              <p id="price-update-error" class="form-error" aria-live="assertive" tabindex="-1">{{ priceUpdateError() }}</p>
              <button type="submit" [disabled]="updatingPrice()">
                {{ updatingPrice() ? 'Enregistrement…' : 'Enregistrer le Prix HT' }}
              </button>
            </form>

            <section aria-labelledby="quotes-title">
              <h4 id="quotes-title">Prix TTC</h4>
              <div class="price-quotes">
                @for (quote of article.priceQuotes; track quote.saleContext ?? quote.taxRate.code) {
                  <dl class="price-quote">
                    @if (quote.saleContext) {
                      <div>
                        <dt>Contexte de Vente</dt>
                        <dd>{{ quote.saleContext === 'takeaway' ? 'À emporter' : 'Sur place' }}</dd>
                      </div>
                    }
                    <div><dt>Taux de TVA</dt><dd>{{ quote.taxRate.ratio }}</dd></div>
                    <div><dt>TVA</dt><dd>{{ quote.vatCents }} centimes</dd></div>
                    <div><dt>Prix TTC</dt><dd>{{ quote.priceTtcCents }} centimes</dd></div>
                  </dl>
                }
              </div>
            </section>
          </article>
        }
      </section>
    </main>
  `,
})
export class AppComponent {
  private readonly api = inject(ArticleApiService);

  readonly model = signal<ArticleFormModel>({ ...initialModel, consumptionModes: [] });
  readonly articleForm = form(this.model, (schemaPath) => {
    required(schemaPath.ean13, { message: 'L’EAN-13 est requis.' });
    pattern(schemaPath.ean13, /^\d{13}$/, { message: 'L’EAN-13 doit contenir 13 chiffres.' });
    required(schemaPath.type);
    required(schemaPath.name, { message: 'Le nom est requis.' });
    required(schemaPath.priceHtCents, { message: 'Le Prix HT en centimes est requis.' });
    pattern(schemaPath.priceHtCents, /^-?\d+$/, { message: 'Le Prix HT doit être un entier de centimes.' });
    required(schemaPath.dlc, { message: 'La DLC est requise.' });
    required(schemaPath.consumptionModes, { message: 'Choisissez au moins un mode.' });
    required(schemaPath.packaging, { message: 'Le Packaging est requis.' });
    hidden(schemaPath.dlc, { when: ({ valueOf }) => valueOf(schemaPath.type) !== 'food' });
    hidden(schemaPath.consumptionModes, { when: ({ valueOf }) => valueOf(schemaPath.type) !== 'food' });
    hidden(schemaPath.packaging, { when: ({ valueOf }) => valueOf(schemaPath.type) !== 'nonFood' });
  });

  readonly consumptionModeOptions: readonly { value: ConsumptionMode; label: string }[] = [
    { value: 'takeaway', label: 'À emporter' },
    { value: 'onsite', label: 'Sur place' },
  ];

  readonly formError = signal('');
  readonly lookupError = signal('');
  readonly detail = signal<ArticleResponse | null>(null);
  readonly lookupEan = signal('');
  readonly submitting = signal(false);
  readonly lookingUp = signal(false);
  readonly priceHtDraft = signal('');
  readonly priceHtFieldError = signal('');
  readonly priceUpdateError = signal('');
  readonly updatingPrice = signal(false);

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.formError.set('');
    let shouldRestoreFocus = false;
    await submit(this.articleForm, {
      action: async () => {
        const result = await this.createArticle();
        shouldRestoreFocus = result !== undefined;
        return result;
      },
      onInvalid: () => {
        shouldRestoreFocus = true;
        this.formError.set('Corrigez les erreurs signalées avant de continuer.');
      },
    });
    if (shouldRestoreFocus) {
      this.restoreFocus();
    }
  }

  toggleMode(mode: ConsumptionMode, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.model.update((value) => ({
      ...value,
      consumptionModes: checked
        ? [...new Set([...value.consumptionModes, mode])]
        : value.consumptionModes.filter((current) => current !== mode),
    }));
  }

  setLookupEan(event: Event): void {
    this.lookupEan.set((event.target as HTMLInputElement).value);
  }

  async onLookup(event: Event): Promise<void> {
    event.preventDefault();
    this.lookupError.set('');
    this.detail.set(null);
    this.priceUpdateError.set('');
    this.priceHtFieldError.set('');
    this.lookingUp.set(true);
    try {
      this.showDetail(await firstValueFrom(this.api.getByEan13(this.lookupEan().trim())));
    } catch (error) {
      this.lookupError.set(this.problemMessage(error, 'Article introuvable.'));
    } finally {
      this.lookingUp.set(false);
    }
  }

  setPriceHtDraft(event: Event): void {
    this.priceHtDraft.set((event.target as HTMLInputElement).value);
  }

  async onPriceUpdate(event: Event): Promise<void> {
    event.preventDefault();
    this.priceUpdateError.set('');
    this.priceHtFieldError.set('');
    const article = this.detail();
    const priceHtCents = this.priceHtDraft().trim();
    if (!article) {
      return;
    }

    if (!/^-?\d+$/.test(priceHtCents)) {
      this.setPriceUpdateError('Le Prix HT doit être un entier de centimes.', 'Le Prix HT doit être un entier de centimes.');
      this.focusPriceUpdate();
      return;
    }

    this.updatingPrice.set(true);
    try {
      this.showDetail(await firstValueFrom(this.api.updatePriceHt(article.ean13, { priceHtCents: Number(priceHtCents) })));
    } catch (error) {
      const problem = this.problemDetails(error);
      const fieldError = problem.errors?.['priceHtCents']?.[0] ?? '';
      this.setPriceUpdateError(problem.title ?? fieldError ?? 'La mise à jour a échoué.', fieldError);
      this.focusPriceUpdate();
    } finally {
      this.updatingPrice.set(false);
    }
  }

  private async createArticle(): Promise<TreeValidationResult> {
    this.submitting.set(true);
    this.detail.set(null);
    try {
      const created = await firstValueFrom(this.api.create(this.toPayload()));
      this.showDetail(created);
      this.lookupEan.set(created.ean13);
      return undefined;
    } catch (error) {
      const problem = this.problemDetails(error);
      this.formError.set(problem.title ?? 'La création a échoué.');
      const fieldErrors = Object.entries(problem.errors ?? {}).flatMap(([field, messages]) => {
        const fieldTree = this.fieldFor(field);
        return fieldTree
          ? messages.map((message) => ({ kind: 'server', message, fieldTree }))
          : [];
      });
      return fieldErrors.length > 0
        ? fieldErrors
        : { kind: 'server', message: problem.title ?? 'La création a échoué.' };
    } finally {
      this.submitting.set(false);
    }
  }

  private toPayload(): ArticleCreatePayload {
    const value = this.model();
    const payload: ArticleCreatePayload = {
      ean13: value.ean13,
      type: value.type,
      name: value.name,
      priceHtCents: Number(value.priceHtCents),
    };

    if (value.type === 'food') {
      payload.dlc = value.dlc;
      payload.consumptionModes = value.consumptionModes;
    } else if (value.packaging) {
      payload.packaging = value.packaging;
    }

    return payload;
  }

  private fieldFor(field: string): FieldTree<unknown> | undefined {
    switch (field) {
      case 'ean13':
        return this.articleForm.ean13;
      case 'type':
        return this.articleForm.type;
      case 'name':
        return this.articleForm.name;
      case 'priceHtCents':
        return this.articleForm.priceHtCents;
      case 'dlc':
        return this.articleForm.dlc;
      case 'consumptionModes':
        return this.articleForm.consumptionModes;
      case 'packaging':
        return this.articleForm.packaging;
      default:
        return undefined;
    }
  }

  private restoreFocus(): void {
    const firstInvalidField = [
      'ean13',
      'type',
      'name',
      'priceHtCents',
      'dlc',
      'consumptionModes',
      'packaging',
    ].find((field) => {
      const fieldTree = this.fieldFor(field);
      return fieldTree ? fieldTree().errors().length > 0 : false;
    });

    const target = firstInvalidField
      ? firstInvalidField === 'consumptionModes'
        ? document.querySelector<HTMLElement>('#consumptionModes input')
        : document.getElementById(firstInvalidField)
      : document.getElementById('form-error');
    target?.focus();
  }

  private problemDetails(error: unknown): ProblemDetails {
    if (error instanceof HttpErrorResponse && typeof error.error === 'object' && error.error !== null) {
      return error.error as ProblemDetails;
    }
    return { title: 'La création a échoué.' };
  }

  private problemMessage(error: unknown, fallback: string): string {
    const problem = this.problemDetails(error);
    return problem.title ?? fallback;
  }

  private showDetail(article: ArticleResponse): void {
    this.detail.set(article);
    this.priceHtDraft.set(String(article.priceHtCents));
    this.priceUpdateError.set('');
    this.priceHtFieldError.set('');
  }

  private setPriceUpdateError(message: string, fieldMessage: string): void {
    this.priceUpdateError.set(message);
    this.priceHtFieldError.set(fieldMessage);
  }

  private focusPriceUpdate(): void {
    document.getElementById('detailPriceHtCents')?.focus();
  }
}
