import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
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
  ArticleListResponse,
  ArticleListQuery,
  ArticleListStatus,
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

type CatalogState = 'loading' | 'ready' | 'empty' | 'error';
type CatalogType = ArticleType | 'all';

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

      <section class="panel" aria-labelledby="catalog-title">
        <div>
          <p class="eyebrow">Vue opérationnelle</p>
          <h2 id="catalog-title">Catalogue</h2>
        </div>
        <p>Retrouvez les références actives, archivées ou l’ensemble du catalogue par nom, EAN-13 et classification.</p>

        <form class="catalog-filters" (submit)="onCatalogSubmit($event)">
          <label>
            Recherche
            <input
              id="catalog-search"
              autocomplete="off"
              placeholder="Nom ou EAN-13"
              [value]="catalogSearch()"
              (input)="setCatalogSearch($event)" />
          </label>

          <label>
            Statut
            <select id="catalog-status" [value]="catalogStatus()" (change)="setCatalogStatus($event)">
              <option value="active">Actifs</option>
              <option value="archived">Archivés</option>
              <option value="all">Tous</option>
            </select>
          </label>

          <label>
            Type
            <select id="catalog-type" [value]="catalogType()" (change)="setCatalogType($event)">
              <option value="all">Tous les types</option>
              <option value="food">Alimentaire</option>
              <option value="nonFood">Non alimentaire</option>
            </select>
          </label>

          @if (catalogType() !== 'nonFood') {
            <label>
              Mode de consommation
              <select id="catalog-mode" [value]="catalogMode()" (change)="setCatalogMode($event)">
                <option value="">Tous les modes</option>
                <option value="takeaway">À emporter</option>
                <option value="onsite">Sur place</option>
              </select>
            </label>
          }

          @if (catalogType() !== 'food') {
            <label>
              Packaging
              <select id="catalog-packaging" [value]="catalogPackaging()" (change)="setCatalogPackaging($event)">
                <option value="">Tous les Packaging</option>
                <option value="new">Neuf</option>
                <option value="refurbished">Reconditionné</option>
                <option value="unsellable">Invendable</option>
              </select>
            </label>
          }

          <button type="submit">Rechercher</button>
        </form>

        <div id="catalog-state" class="catalog-state" aria-live="polite" role="status">
          @switch (catalogState()) {
            @case ('loading') {
              <p>Chargement du Catalogue…</p>
            }
            @case ('ready') {
              <p>{{ catalogArticles().length }} Article{{ catalogArticles().length > 1 ? 's' : '' }} trouvé{{ catalogArticles().length > 1 ? 's' : '' }}.</p>
            }
            @case ('empty') {
              <p>Aucun Article ne correspond à ces critères.</p>
            }
            @case ('error') {
              <p class="form-error" role="alert">{{ catalogError() }}</p>
              <button type="button" class="secondary-button" (click)="retryCatalog()">Réessayer</button>
            }
          }
        </div>
        <p id="catalog-lifecycle-status" aria-live="polite" role="status">{{ lifecycleMessage() }}</p>

        @if (catalogStale()) {
          <p id="catalog-stale" class="stale-result">Les lignes affichées proviennent d’une recherche précédente et ne sont plus à jour.</p>
        }

        @if (catalogArticles().length > 0) {
          <div class="table-wrap">
            <table>
              <caption class="sr-only">Résultats du Catalogue</caption>
              <thead>
                <tr>
                  <th scope="col">Article</th>
                  <th scope="col">EAN-13</th>
                  <th scope="col">Type</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Classification</th>
                  <th scope="col">Prix HT</th>
                  <th scope="col"><span class="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                @for (article of catalogArticles(); track article.ean13) {
                  <tr>
                    <th scope="row">{{ article.name }}</th>
                    <td>{{ article.ean13 }}</td>
                    <td>{{ article.type === 'food' ? 'Alimentaire' : 'Non alimentaire' }}</td>
                    <td>{{ isActiveArticle(article) ? 'Actif' : 'Archivé' }}</td>
                    <td>
                      {{ article.type === 'food'
                        ? formatConsumptionModes(article.consumptionModes ?? [])
                        : formatPackaging(article.packaging) }}
                    </td>
                    <td>{{ article.priceHtCents }} centimes</td>
                    <td>
                      <button
                        type="button"
                        class="table-action"
                        [attr.aria-label]="'Consulter ' + article.name"
                        (click)="openCatalogArticle(article)">
                        Détail
                      </button>
                      <button
                        type="button"
                        class="table-action"
                        [disabled]="transitioningEan() === article.ean13"
                        [attr.aria-label]="(isActiveArticle(article) ? 'Archiver ' : 'Réactiver ') + article.name"
                        (click)="onCatalogLifecycle(article)">
                        {{ transitioningEan() === article.ean13 ? 'Traitement…' : (isActiveArticle(article) ? 'Archiver' : 'Réactiver') }}
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

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
              <div><dt>Statut</dt><dd>{{ isActiveArticle(article) ? 'Actif' : 'Archivé' }}</dd></div>
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

            <button
              type="button"
              class="secondary-button"
              [disabled]="transitioningEan() === article.ean13"
              (click)="onCatalogLifecycle(article)">
              {{ transitioningEan() === article.ean13 ? 'Traitement…' : (isActiveArticle(article) ? 'Archiver l’Article' : 'Réactiver l’Article') }}
            </button>

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
export class AppComponent implements OnInit {
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
  readonly catalogArticles = signal<ArticleListResponse[]>([]);
  readonly catalogState = signal<CatalogState>('loading');
  readonly catalogError = signal('');
  readonly catalogStale = signal(false);
  readonly catalogSearch = signal('');
  readonly catalogStatus = signal<ArticleListStatus>('active');
  readonly catalogType = signal<CatalogType>('all');
  readonly catalogMode = signal<ConsumptionMode | ''>('');
  readonly catalogPackaging = signal<Packaging | ''>('');
  readonly transitioningEan = signal('');
  readonly lifecycleMessage = signal('');

  private catalogRequestId = 0;
  private detailRequestId = 0;
  private lifecycleRequestId = 0;

  ngOnInit(): void {
    void this.loadCatalog();
  }
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

  setCatalogSearch(event: Event): void {
    this.catalogSearch.set((event.target as HTMLInputElement).value);
  }

  setCatalogStatus(event: Event): void {
    this.catalogStatus.set((event.target as HTMLSelectElement).value as ArticleListStatus);
  }

  setCatalogType(event: Event): void {
    const type = (event.target as HTMLSelectElement).value as CatalogType;
    this.catalogType.set(type);
    if (type === 'food') {
      this.catalogPackaging.set('');
    }
    if (type === 'nonFood') {
      this.catalogMode.set('');
    }
  }

  setCatalogMode(event: Event): void {
    this.catalogMode.set((event.target as HTMLSelectElement).value as ConsumptionMode | '');
  }

  setCatalogPackaging(event: Event): void {
    this.catalogPackaging.set((event.target as HTMLSelectElement).value as Packaging | '');
  }

  async onCatalogSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await this.loadCatalog();
  }

  retryCatalog(): void {
    void this.loadCatalog();
  }

  openCatalogArticle(article: ArticleListResponse): void {
    this.lookupEan.set(article.ean13);
    void this.loadDetail(article.ean13);
  }

  isActiveArticle(article: ArticleListResponse | ArticleResponse): boolean {
    return article.status ? article.status === 'active' : article.isActive;
  }

  async onCatalogLifecycle(article: ArticleListResponse | ArticleResponse): Promise<void> {
    const requestId = ++this.lifecycleRequestId;
    const ean13 = article.ean13;
    this.lifecycleMessage.set('');
    this.transitioningEan.set(ean13);
    try {
      const updated = await firstValueFrom(
        this.isActiveArticle(article)
        ? this.api.archive(ean13)
        : this.api.reactivate(ean13),
      );
      if (requestId !== this.lifecycleRequestId) {
        if (this.detail()?.ean13 === ean13) {
          await this.loadDetail(ean13, true);
        }
      } else {
        if (this.detail()?.ean13 === ean13) {
          this.showDetail(updated);
        }
        this.lifecycleMessage.set(
          `${updated.name} est ${updated.status === 'active' ? 'actif' : 'archivé'}.`,
        );
      }
      await this.loadCatalog();
    } catch (error) {
      if (requestId !== this.lifecycleRequestId) {
        return;
      }

      this.lifecycleMessage.set(
        this.problemMessage(error, 'La transition du cycle de vie a échoué.'),
      );
    } finally {
      if (requestId === this.lifecycleRequestId && this.transitioningEan() === ean13) {
        this.transitioningEan.set('');
      }
    }
  }

  formatConsumptionModes(modes: ConsumptionMode[]): string {
    return modes
      .map((mode) => mode === 'takeaway' ? 'À emporter' : 'Sur place')
      .join(', ');
  }

  formatPackaging(packaging: Packaging | undefined): string {
    return packaging === 'new'
      ? 'Neuf'
      : packaging === 'refurbished'
        ? 'Reconditionné'
        : packaging === 'unsellable'
          ? 'Invendable'
          : '—';
  }

  async onLookup(event: Event): Promise<void> {
    event.preventDefault();
    await this.loadDetail(this.lookupEan().trim());
  }

  private async loadDetail(ean13: string, preserveCurrentDetail = false): Promise<void> {
    this.invalidateDetailRequest();
    const requestId = this.detailRequestId;
    this.lookupError.set('');
    if (!preserveCurrentDetail) {
      this.detail.set(null);
      this.priceUpdateError.set('');
      this.priceHtFieldError.set('');
    }
    this.lookingUp.set(true);
    try {
      const article = await firstValueFrom(this.api.getByEan13(ean13));
      if (requestId === this.detailRequestId) {
        this.setDetail(article);
      }
    } catch (error) {
      if (requestId === this.detailRequestId) {
        this.lookupError.set(this.problemMessage(error, 'Article introuvable.'));
      }
    } finally {
      if (requestId === this.detailRequestId) {
        this.lookingUp.set(false);
      }
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
    this.invalidateDetailRequest();
    this.detail.set(null);
    try {
      const created = await firstValueFrom(this.api.create(this.toPayload()));
      this.showDetail(created);
      this.lookupEan.set(created.ean13);
      await this.loadCatalog();
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

  private async loadCatalog(): Promise<void> {
    const requestId = ++this.catalogRequestId;
    const hasPreviousResult = this.catalogArticles().length > 0;
    this.catalogState.set('loading');
    this.catalogError.set('');
    this.catalogStale.set(hasPreviousResult);

    try {
      const articles = await firstValueFrom(this.api.list(this.toCatalogQuery()));
      if (requestId !== this.catalogRequestId) {
        return;
      }

      this.catalogArticles.set(articles);
      this.catalogState.set(articles.length > 0 ? 'ready' : 'empty');
      this.catalogStale.set(false);
    } catch (error) {
      if (requestId !== this.catalogRequestId) {
        return;
      }

      this.catalogState.set('error');
      this.catalogError.set(this.problemMessage(error, 'Le Catalogue ne peut pas être chargé. Réessayez.'));
      this.catalogStale.set(this.catalogArticles().length > 0);
    }
  }

  private toCatalogQuery(): ArticleListQuery {
    const query: ArticleListQuery = { status: this.catalogStatus() };
    const search = this.catalogSearch().trim();
    if (search) {
      query.search = search;
    }
    const type = this.catalogType();
    if (type !== 'all') {
      query.type = type;
    }
    if (this.catalogMode()) {
      query.mode = this.catalogMode() as ConsumptionMode;
    }
    if (this.catalogPackaging()) {
      query.packaging = this.catalogPackaging() as Packaging;
    }
    return query;
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

  private problemDetails(error: unknown, fallback = 'La création a échoué.'): ProblemDetails {
    if (error instanceof HttpErrorResponse && typeof error.error === 'object' && error.error !== null) {
      return error.error as ProblemDetails;
    }
    return { title: fallback };
  }

  private problemMessage(error: unknown, fallback: string): string {
    const problem = this.problemDetails(error, fallback);
    return problem.title ?? fallback;
  }

  private showDetail(article: ArticleResponse): void {
    this.invalidateDetailRequest();
    this.setDetail(article);
  }

  private setDetail(article: ArticleResponse): void {
    this.detail.set(article);
    this.priceHtDraft.set(String(article.priceHtCents));
    this.priceUpdateError.set('');
    this.priceHtFieldError.set('');
  }

  private invalidateDetailRequest(): void {
    this.detailRequestId += 1;
    this.lookingUp.set(false);
  }

  private setPriceUpdateError(message: string, fieldMessage: string): void {
    this.priceUpdateError.set(message);
    this.priceHtFieldError.set(fieldMessage);
  }

  private focusPriceUpdate(): void {
    document.getElementById('detailPriceHtCents')?.focus();
  }
}
