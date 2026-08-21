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
  ArticleAttributesUpdatePayload,
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
import {
  StockApiService,
  StockAvailability,
  StockPositionResponse,
  StockReason,
  SupplyPayload,
} from './stock-api.service';
import {
  InventoryApiService,
  InventoryResponse,
} from './inventory-api.service';

interface ArticleFormModel {
  ean13: string;
  type: ArticleType;
  name: string;
  priceHtCents: string;
  dlc: string;
  consumptionModes: ConsumptionMode[];
  packaging: Packaging | '';
}

interface SupplyFormModel {
  ean13: string;
  quantity: string;
}

interface InventoryFormModel {
  ean13: string;
  countedQuantity: string;
}

type CatalogState = 'loading' | 'ready' | 'empty' | 'error';
type CatalogType = ArticleType | 'all';
type StockState = 'loading' | 'ready' | 'empty' | 'error';
type InventoryRestoreState = 'loading' | 'ready' | 'empty' | 'error';

const initialModel: ArticleFormModel = {
  ean13: '',
  type: 'food',
  name: '',
  priceHtCents: '',
  dlc: '',
  consumptionModes: [],
  packaging: '',
};

const initialInventoryModel: InventoryFormModel = {
  ean13: '',
  countedQuantity: '',
};

const lastInventoryIdStorageKey = 'token-warehouse.last-inventory-id';

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

      <nav class="main-nav" aria-label="Navigation principale">
        <a href="#stock-panel">Stock</a>
        <a href="#supply-panel">Approvisionnement</a>
        <a href="#inventory-title">Inventaire</a>
        <a href="#catalog-title">Catalogue</a>
      </nav>

      <section id="stock-panel" class="panel" aria-labelledby="stock-title">
        <div>
          <p class="eyebrow">Vue opérationnelle</p>
          <h2 id="stock-title">Stock courant</h2>
        </div>
        <p>Le Stock vendable est calculé par le serveur à partir du Stock physique et des règles courantes de l’Article.</p>

        <div id="stock-state" class="catalog-state" aria-live="polite" role="status">
          @switch (stockState()) {
            @case ('loading') {
              <p>Chargement du Stock…</p>
            }
            @case ('ready') {
              <p>{{ stockPositions().length }} Article{{ stockPositions().length > 1 ? 's' : '' }} trouvé{{ stockPositions().length > 1 ? 's' : '' }}.</p>
            }
            @case ('empty') {
              <p>Aucun Article n’est présent dans le Catalogue.</p>
            }
            @case ('error') {
              <p class="form-error" role="alert">{{ stockError() }}</p>
              <button type="button" class="secondary-button" (click)="retryStock()">Réessayer</button>
            }
          }
        </div>

        @if (stockPositions().length > 0) {
          <div class="table-wrap">
            <table id="stock-table">
              <caption class="sr-only">Positions courantes du Stock</caption>
              <thead>
                <tr>
                  <th scope="col">Article</th>
                  <th scope="col">EAN-13</th>
                  <th scope="col">Stock physique</th>
                  <th scope="col">Stock vendable</th>
                  <th scope="col">Disponibilité</th>
                  <th scope="col">Raison</th>
                  <th scope="col"><span class="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                @for (position of stockPositions(); track position.ean13) {
                  <tr>
                    <th scope="row">{{ position.name }}</th>
                    <td>{{ position.ean13 }}</td>
                    <td>{{ position.physicalQuantity }} unités</td>
                    <td>{{ position.sellableQuantity }} unités</td>
                    <td>{{ formatStockAvailability(position.availability) }}</td>
                    <td>{{ formatStockReason(position.reason) }}</td>
                    <td>
                      <button
                        type="button"
                        class="table-action"
                        [disabled]="stockDetailLoading()"
                        [attr.aria-label]="'Consulter le détail du Stock de ' + position.name"
                        (click)="openStockPosition(position)">
                        {{ stockDetailLoading() ? 'Chargement…' : 'Détail' }}
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        @if (stockDetail(); as position) {
          <article id="stock-detail" class="stock-detail" role="region" aria-labelledby="stock-detail-title" tabindex="-1">
            <h3 id="stock-detail-title">Détail du Stock — {{ position.name }}</h3>
            <dl>
              <div><dt>EAN-13</dt><dd>{{ position.ean13 }}</dd></div>
              <div><dt>Stock physique</dt><dd>{{ position.physicalQuantity }} unités</dd></div>
              <div><dt>Stock vendable</dt><dd>{{ position.sellableQuantity }} unités</dd></div>
              <div><dt>Disponibilité</dt><dd>{{ formatStockAvailability(position.availability) }}</dd></div>
              <div><dt>Raison</dt><dd>{{ formatStockReason(position.reason) }}</dd></div>
            </dl>
            <button type="button" class="secondary-button" (click)="closeStockDetail()">Fermer le détail du Stock</button>
          </article>
        }

        @if (stockDetailError()) {
          <p id="stock-detail-error" class="form-error" role="alert" aria-live="assertive">{{ stockDetailError() }}</p>
        }
      </section>

      <section id="supply-panel" class="panel" aria-labelledby="supply-title">
        <div>
          <p class="eyebrow">Mouvement immédiat</p>
          <h2 id="supply-title">Enregistrer un Approvisionnement</h2>
        </div>
        <p>La position visible est remplacée par le résultat engagé par le serveur après la réception.</p>

        <form id="supply-form" class="supply-form" novalidate (submit)="onSupplySubmit($event)">
          <label>
            Référence EAN-13
            <input
              id="supplyEan13"
              autocomplete="off"
              inputmode="numeric"
              [formField]="supplyForm.ean13"
              [attr.aria-invalid]="supplyFieldError('ean13') ? 'true' : null"
              aria-describedby="supply-ean13-error"
              />
            <span id="supply-ean13-error" class="field-error">{{ supplyFieldError('ean13') }}</span>
          </label>

          <label>
            Quantité entière positive
            <input
              id="supplyQuantity"
              type="number"
              step="1"
              inputmode="numeric"
              [formField]="supplyForm.quantity"
              [attr.aria-invalid]="supplyFieldError('quantity') ? 'true' : null"
              aria-describedby="supply-quantity-error"
              />
            <span id="supply-quantity-error" class="field-error">{{ supplyFieldError('quantity') }}</span>
          </label>

          <button type="submit" [disabled]="supplySubmitting()">
            {{ supplySubmitting() ? 'Réception…' : 'Enregistrer l’Approvisionnement' }}
          </button>
        </form>
        <p id="supply-status" role="status" aria-live="assertive" tabindex="-1">{{ supplyMessage() }}</p>
      </section>

      <section class="panel" aria-labelledby="inventory-title">
        <div>
          <p class="eyebrow">Opération de stock</p>
          <h2 id="inventory-title">Enregistrer un Inventaire</h2>
        </div>
        <p>Comptez une Référence EAN-13 pour établir une nouvelle base de Stock physique.</p>

        <form id="inventory-form" class="form-grid" novalidate (submit)="onInventorySubmit($event)">
          <label>
            Référence EAN-13
            <input
              id="inventory-ean13"
              autocomplete="off"
              inputmode="numeric"
              [formField]="inventoryForm.ean13"
              aria-describedby="inventory-ean13-error" />
            @if (inventoryForm.ean13().errors().length > 0) {
              <span id="inventory-ean13-error" class="field-error">{{ inventoryForm.ean13().errors()[0].message }}</span>
            }
          </label>

          <label>
            Quantité comptée
            <input
              id="inventory-countedQuantity"
              type="number"
              step="1"
              inputmode="numeric"
              [formField]="inventoryForm.countedQuantity"
              aria-describedby="inventory-countedQuantity-error" />
            @if (inventoryForm.countedQuantity().errors().length > 0) {
              <span id="inventory-countedQuantity-error" class="field-error">{{ inventoryForm.countedQuantity().errors()[0].message }}</span>
            }
          </label>

          <button type="submit" [disabled]="inventorySubmitting()">
            {{ inventorySubmitting() ? 'Enregistrement…' : 'Enregistrer l’Inventaire' }}
          </button>
        </form>

        @if (inventoryRestoreState() === 'loading') {
          <p id="inventory-restore-state" role="status" aria-live="polite">Relecture du dernier Inventaire…</p>
        }
        @if (inventoryRestoreState() === 'error') {
          <p id="inventory-restore-state" class="form-error" role="alert" aria-live="assertive">
            Le dernier Inventaire ne peut pas être relu.
          </p>
        }

        @if (inventoryError()) {
          <p id="inventory-error" class="form-error" role="alert" aria-live="assertive" tabindex="-1">{{ inventoryError() }}</p>
        }

        @if (inventoryReceipt(); as receipt) {
          <article id="inventory-result" class="stock-detail" role="region" aria-live="polite" aria-labelledby="inventory-result-title" tabindex="-1">
            <h3 id="inventory-result-title">Inventaire enregistré</h3>
            <dl>
              <div><dt>EAN-13</dt><dd>{{ receipt.operation.ean13 }}</dd></div>
              <div><dt>Stock physique précédent</dt><dd>{{ receipt.operation.previousPhysicalStock }} unités</dd></div>
              <div><dt>Quantité comptée</dt><dd>{{ receipt.operation.countedQuantity }} unités</dd></div>
              <div><dt>Écart d’inventaire</dt><dd>{{ formatInventoryDifference(receipt.operation.inventoryDifference) }}</dd></div>
              <div><dt>Nouvelle base physique</dt><dd>{{ receipt.operation.resultingPhysicalStock }} unités</dd></div>
              <div><dt>Stock vendable</dt><dd>{{ receipt.position.sellableStock }} unités</dd></div>
              <div><dt>Disponibilité</dt><dd>{{ formatStockAvailability(receipt.position.availability) }}</dd></div>
              <div><dt>Raison</dt><dd>{{ formatStockReason(receipt.position.reason) }}</dd></div>
              <div><dt>Timestamp UTC</dt><dd>{{ receipt.operation.timestampUtc }}</dd></div>
            </dl>
          </article>
        }
      </section>

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
              <div><dt>Stock physique</dt><dd>{{ article.stock?.physicalQuantity ?? 0 }} unités</dd></div>
              <div><dt>Stock vendable</dt><dd>{{ article.stock?.sellableQuantity ?? 0 }} unités</dd></div>
            </dl>

            <button
              type="button"
              class="secondary-button"
              [disabled]="transitioningEan() === article.ean13"
              (click)="onCatalogLifecycle(article)">
              {{ transitioningEan() === article.ean13 ? 'Traitement…' : (isActiveArticle(article) ? 'Archiver l’Article' : 'Réactiver l’Article') }}
            </button>

            @if (isActiveArticle(article)) {
              <form id="attribute-update-form" (submit)="onAttributeUpdate($event)" aria-labelledby="attribute-update-title">
                <h4 id="attribute-update-title">Attributs évolutifs</h4>
                <label>
                  Nom
                  <input
                    id="detailName"
                    autocomplete="off"
                    [value]="attributeNameDraft()"
                    [attr.aria-invalid]="attributeFieldError('name') ? 'true' : null"
                    aria-describedby="detail-name-error"
                    (input)="setAttributeName($event)" />
                  @if (attributeFieldError('name')) {
                    <span id="detail-name-error" class="field-error">{{ attributeFieldError('name') }}</span>
                  }
                </label>

                @if (article.type === 'food') {
                  <label>
                    DLC
                    <input
                      id="detailDlc"
                      type="date"
                      [value]="attributeDlcDraft()"
                      [attr.aria-invalid]="attributeFieldError('dlc') ? 'true' : null"
                      aria-describedby="detail-dlc-error"
                      (input)="setAttributeDlc($event)" />
                    @if (attributeFieldError('dlc')) {
                      <span id="detail-dlc-error" class="field-error">{{ attributeFieldError('dlc') }}</span>
                    }
                  </label>

                  <fieldset id="detailConsumptionModes" aria-describedby="detail-consumptionModes-error">
                    <legend>Modes de consommation</legend>
                    @for (mode of consumptionModeOptions; track mode.value) {
                      <label class="choice">
                        <input
                          type="checkbox"
                          [checked]="attributeModesDraft().includes(mode.value)"
                          (change)="toggleAttributeMode(mode.value, $event)" />
                        {{ mode.label }}
                      </label>
                    }
                    @if (attributeFieldError('consumptionModes')) {
                      <span id="detail-consumptionModes-error" class="field-error">{{ attributeFieldError('consumptionModes') }}</span>
                    }
                  </fieldset>
                }

                @if (article.type === 'nonFood') {
                  <label>
                    Packaging
                    <select
                      id="detailPackaging"
                      [value]="attributePackagingDraft()"
                      [attr.aria-invalid]="attributeFieldError('packaging') ? 'true' : null"
                      aria-describedby="detail-packaging-error"
                      (change)="setAttributePackaging($event)">
                      <option value="">Sélectionner</option>
                      <option value="new">Neuf</option>
                      <option value="refurbished">Reconditionné</option>
                      <option value="unsellable">Invendable</option>
                    </select>
                    @if (attributeFieldError('packaging')) {
                      <span id="detail-packaging-error" class="field-error">{{ attributeFieldError('packaging') }}</span>
                    }
                  </label>
                }

                <p id="attribute-update-error" class="form-error" aria-live="assertive" tabindex="-1">{{ attributeUpdateError() }}</p>
                <button type="submit" [disabled]="updatingAttributes()">
                  {{ updatingAttributes() ? 'Enregistrement…' : 'Enregistrer les attributs' }}
                </button>
              </form>
            }

            @if (isActiveArticle(article)) {
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
            }

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
  private readonly stockApi = inject(StockApiService);
  private readonly inventoryApi = inject(InventoryApiService);

  readonly model = signal<ArticleFormModel>({ ...initialModel, consumptionModes: [] });
  readonly supplyModel = signal<SupplyFormModel>({ ean13: '', quantity: '' });
  readonly supplyForm = form(this.supplyModel, (schemaPath) => {
    required(schemaPath.ean13, { message: 'L’EAN-13 est requis.' });
    pattern(schemaPath.ean13, /^\d{13}$/, { message: 'L’EAN-13 doit contenir 13 chiffres.' });
    required(schemaPath.quantity, { message: 'La quantité est requise.' });
    pattern(schemaPath.quantity, /^[1-9]\d*$/, { message: 'La quantité doit être un entier strictement positif.' });
  });
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

  readonly inventoryModel = signal<InventoryFormModel>({ ...initialInventoryModel });
  readonly inventoryForm = form(this.inventoryModel, (schemaPath) => {
    required(schemaPath.ean13, { message: 'L’EAN-13 est requis.' });
    pattern(schemaPath.ean13, /^\d{13}$/, { message: 'L’EAN-13 doit contenir 13 chiffres.' });
    required(schemaPath.countedQuantity, { message: 'La quantité comptée est requise.' });
    pattern(schemaPath.countedQuantity, /^\d+$/, { message: 'La quantité comptée doit être un entier supérieur ou égal à zéro.' });
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
  readonly stockPositions = signal<StockPositionResponse[]>([]);
  readonly stockState = signal<StockState>('loading');
  readonly stockError = signal('');
  readonly stockDetail = signal<StockPositionResponse | null>(null);
  readonly stockDetailError = signal('');
  readonly stockDetailLoading = signal(false);
  readonly supplyFieldErrors = signal<Record<string, string>>({});
  readonly supplyMessage = signal('');
  readonly supplySubmitting = signal(false);
  readonly inventoryError = signal('');
  readonly inventoryReceipt = signal<InventoryResponse | null>(null);
  readonly inventorySubmitting = signal(false);
  readonly inventoryRestoreState = signal<InventoryRestoreState>('empty');

  private catalogRequestId = 0;
  private stockRequestId = 0;
  private stockDetailRequestId = 0;
  private detailRequestId = 0;
  private lifecycleRequestId = 0;
  private supplyRequestId = 0;
  private inventoryRestoreRequestId = 0;

  ngOnInit(): void {
    void this.loadCatalog();
    void this.loadStock();
    void this.loadLastInventory();
  }
  readonly priceHtDraft = signal('');
  readonly priceHtFieldError = signal('');
  readonly priceUpdateError = signal('');
  readonly updatingPrice = signal(false);
  readonly attributeNameDraft = signal('');
  readonly attributeDlcDraft = signal('');
  readonly attributeModesDraft = signal<ConsumptionMode[]>([]);
  readonly attributePackagingDraft = signal<Packaging | ''>('');
  readonly attributeFieldErrors = signal<Record<string, string>>({});
  readonly attributeUpdateError = signal('');
  readonly updatingAttributes = signal(false);

  private attributeRequestId = 0;

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

  retryStock(): void {
    void this.loadStock();
  }

  async onInventorySubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.inventoryError.set('');
    this.inventoryReceipt.set(null);
    this.inventoryRestoreRequestId += 1;
    this.inventoryRestoreState.set('empty');
    let shouldRestoreFocus = false;
    await submit(this.inventoryForm, {
      action: async () => {
        const result = await this.registerInventory();
        shouldRestoreFocus = result !== undefined;
        return result;
      },
      onInvalid: () => {
        shouldRestoreFocus = true;
        this.inventoryError.set('Corrigez les erreurs signalées avant de continuer.');
      },
    });
    if (shouldRestoreFocus) {
      this.restoreInventoryFocus();
    }
  }

  async openStockPosition(position: StockPositionResponse): Promise<void> {
    const requestId = ++this.stockDetailRequestId;
    this.stockDetail.set(null);
    this.stockDetailError.set('');
    this.stockDetailLoading.set(true);
    try {
      const detail = await firstValueFrom(this.stockApi.getByEan13(position.ean13));
      if (requestId === this.stockDetailRequestId) {
        this.stockDetail.set(detail);
        setTimeout(() => document.getElementById('stock-detail')?.focus());
      }
    } catch (error) {
      if (requestId === this.stockDetailRequestId) {
        this.stockDetailError.set(this.problemMessage(error, 'Le détail du Stock ne peut pas être chargé.'));
      }
    } finally {
      if (requestId === this.stockDetailRequestId) {
        this.stockDetailLoading.set(false);
      }
    }
  }

  closeStockDetail(): void {
    this.stockDetailRequestId += 1;
    this.stockDetailLoading.set(false);
    this.stockDetail.set(null);
    this.stockDetailError.set('');
  }

  supplyFieldError(field: string): string {
    const serverError = this.supplyFieldErrors()[field];
    if (serverError) {
      return serverError;
    }

    const errors = field === 'ean13'
      ? this.supplyForm.ean13().errors()
      : this.supplyForm.quantity().errors();
    return errors[0]?.message ?? '';
  }

  async onSupplySubmit(event: Event): Promise<void> {
    event.preventDefault();
    const requestId = ++this.supplyRequestId;
    this.supplyFieldErrors.set({});
    this.supplyMessage.set('');
    this.supplySubmitting.set(true);

    const payload: SupplyPayload = {
      ean13: this.supplyModel().ean13.trim(),
      quantity: this.toSupplyQuantity(this.supplyModel().quantity),
    };

    try {
      const response = await firstValueFrom(this.stockApi.recordSupply(payload));
      if (requestId !== this.supplyRequestId) {
        return;
      }

      this.replaceStockPosition(response.position);
      this.supplyMessage.set(
        `Approvisionnement ${response.operation.id} enregistré le ${response.operation.occurredAt}.`,
      );
      setTimeout(() => document.getElementById('supply-status')?.focus());
    } catch (error) {
      if (requestId !== this.supplyRequestId) {
        return;
      }

      const problem = this.problemDetails(error, 'L’Approvisionnement n’a pas pu être enregistré.');
      this.supplyFieldErrors.set(
        Object.fromEntries(
          Object.entries(problem.errors ?? {}).map(([field, messages]) => [field, messages[0] ?? ''])
        )
      );
      this.supplyMessage.set(problem.title ?? 'L’Approvisionnement n’a pas pu être enregistré.');
      this.focusSupplyError();
    } finally {
      if (requestId === this.supplyRequestId) {
        this.supplySubmitting.set(false);
      }
    }
  }

  formatStockAvailability(availability: StockAvailability): string {
    return availability === 'AVAILABLE'
      ? 'Disponible'
      : availability === 'OUT_OF_STOCK'
        ? 'Rupture'
        : 'Non vendable';
  }

  formatStockReason(reason: StockReason | null): string {
    return reason === 'ARCHIVED'
      ? 'Article archivé'
      : reason === 'DLC_EXPIRED'
        ? 'DLC dépassée'
        : reason === 'UNSELLABLE_PACKAGING'
          ? 'Packaging invendable'
          : '—';
  }

  formatInventoryDifference(difference: number): string {
    return difference > 0 ? `+${difference}` : String(difference);
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
      this.attributeUpdateError.set('');
      this.attributeFieldErrors.set({});
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

  setAttributeName(event: Event): void {
    this.attributeNameDraft.set((event.target as HTMLInputElement).value);
  }

  setAttributeDlc(event: Event): void {
    this.attributeDlcDraft.set((event.target as HTMLInputElement).value);
  }

  toggleAttributeMode(mode: ConsumptionMode, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.attributeModesDraft.update((current) => checked
      ? [...new Set([...current, mode])]
      : current.filter((value) => value !== mode));
  }

  setAttributePackaging(event: Event): void {
    this.attributePackagingDraft.set((event.target as HTMLSelectElement).value as Packaging | '');
  }

  attributeFieldError(field: string): string {
    return this.attributeFieldErrors()[field] ?? '';
  }

  async onAttributeUpdate(event: Event): Promise<void> {
    event.preventDefault();
    const article = this.detail();
    if (!article || !this.isActiveArticle(article)) {
      return;
    }

    this.attributeUpdateError.set('');
    this.attributeFieldErrors.set({});
    const requestId = ++this.attributeRequestId;
    const payload: ArticleAttributesUpdatePayload = { name: this.attributeNameDraft() };
    if (article.type === 'food') {
      payload.dlc = this.attributeDlcDraft();
      payload.consumptionModes = [...this.attributeModesDraft()];
    } else {
      payload.packaging = this.attributePackagingDraft() as Packaging;
    }

    this.updatingAttributes.set(true);
    try {
      const updated = await firstValueFrom(this.api.updateAttributes(article.ean13, payload));
      if (requestId !== this.attributeRequestId) {
        return;
      }

      this.showDetail(updated);
      this.attributeUpdateError.set(`Les attributs de ${updated.name} ont été mis à jour.`);
    } catch (error) {
      if (requestId !== this.attributeRequestId) {
        return;
      }

      const problem = this.problemDetails(error, 'La modification des attributs a échoué.');
      this.attributeFieldErrors.set(
        Object.fromEntries(
          Object.entries(problem.errors ?? {}).map(([field, messages]) => [field, messages[0] ?? ''])
        )
      );
      this.attributeUpdateError.set(problem.title ?? 'La modification des attributs a échoué.');
      this.focusAttributeError();
    } finally {
      if (requestId === this.attributeRequestId) {
        this.updatingAttributes.set(false);
      }
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

  private async registerInventory(): Promise<TreeValidationResult> {
    this.inventorySubmitting.set(true);
    this.inventoryReceipt.set(null);
    try {
      const value = this.inventoryModel();
      const receipt = await firstValueFrom(this.inventoryApi.register({
        ean13: value.ean13,
        countedQuantity: Number(value.countedQuantity),
      }));
      this.inventoryReceipt.set(receipt);
      this.inventoryRestoreState.set('ready');
      sessionStorage.setItem(lastInventoryIdStorageKey, receipt.operation.id);
      setTimeout(() => document.getElementById('inventory-result')?.focus());
      void this.loadStock();
      return undefined;
    } catch (error) {
      const problem = this.problemDetails(error, 'L’Inventaire n’a pas pu être enregistré.');
      this.inventoryError.set(problem.title ?? 'L’Inventaire n’a pas pu être enregistré.');
      const fieldErrors = Object.entries(problem.errors ?? {}).flatMap(([field, messages]) => {
        const fieldTree = this.inventoryFieldFor(field);
        return fieldTree
          ? messages.map((message) => ({ kind: 'server', message, fieldTree }))
          : [];
      });
      return fieldErrors.length > 0
        ? fieldErrors
        : { kind: 'server', message: problem.title ?? 'L’Inventaire n’a pas pu être enregistré.' };
    } finally {
      this.inventorySubmitting.set(false);
    }
  }

  private async loadLastInventory(): Promise<void> {
    const requestId = ++this.inventoryRestoreRequestId;
    const id = sessionStorage.getItem(lastInventoryIdStorageKey);
    if (!id) {
      return;
    }

    this.inventoryRestoreState.set('loading');
    try {
      const operation = await firstValueFrom(this.inventoryApi.getById(id));
      const position = await firstValueFrom(this.stockApi.getByEan13(operation.ean13));
      if (requestId !== this.inventoryRestoreRequestId) {
        return;
      }

      this.inventoryReceipt.set({
        operation,
        position: {
          ean13: position.ean13,
          physicalStock: position.physicalQuantity,
          sellableStock: position.sellableQuantity,
          availability: position.availability,
          reason: position.reason,
        },
      });
      this.inventoryRestoreState.set('ready');
    } catch {
      if (requestId === this.inventoryRestoreRequestId) {
        this.inventoryRestoreState.set('error');
      }
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

  private async loadStock(): Promise<void> {
    const requestId = ++this.stockRequestId;
    this.stockState.set('loading');
    this.stockError.set('');
    this.stockPositions.set([]);
    this.closeStockDetail();

    try {
      const positions = await firstValueFrom(this.stockApi.list());
      if (requestId !== this.stockRequestId) {
        return;
      }

      this.stockPositions.set(positions);
      this.stockState.set(positions.length > 0 ? 'ready' : 'empty');
    } catch (error) {
      if (requestId !== this.stockRequestId) {
        return;
      }

      this.stockState.set('error');
      this.stockError.set(this.problemMessage(error, 'Le Stock ne peut pas être chargé. Réessayez.'));
    }
  }

  private replaceStockPosition(position: StockPositionResponse): void {
    this.stockRequestId += 1;
    const positions = this.stockPositions().filter((current) => current.ean13 !== position.ean13);
    positions.push(position);
    positions.sort((left, right) => left.ean13.localeCompare(right.ean13));
    this.stockPositions.set(positions);
    this.stockState.set(positions.length > 0 ? 'ready' : 'empty');
    if (this.stockDetail()?.ean13 === position.ean13) {
      this.stockDetail.set(position);
    }
    this.detail.update((article) => article?.ean13 === position.ean13
      ? {
          ...article,
          stock: {
            physicalQuantity: position.physicalQuantity,
            sellableQuantity: position.sellableQuantity,
          },
        }
      : article);
  }

  private toSupplyQuantity(value: string): number | string | null {
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }

    return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
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

  private inventoryFieldFor(field: string): FieldTree<unknown> | undefined {
    switch (field) {
      case 'ean13':
        return this.inventoryForm.ean13;
      case 'countedQuantity':
        return this.inventoryForm.countedQuantity;
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

  private restoreInventoryFocus(): void {
    const firstInvalidField = ['ean13', 'countedQuantity'].find((field) => {
      const fieldTree = this.inventoryFieldFor(field);
      return fieldTree ? fieldTree().errors().length > 0 : false;
    });
    (firstInvalidField
      ? document.getElementById(`inventory-${firstInvalidField}`)
      : document.getElementById('inventory-countedQuantity'))?.focus();
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
    this.attributeNameDraft.set(article.name);
    this.attributeDlcDraft.set(article.dlc ?? '');
    this.attributeModesDraft.set([...(article.consumptionModes ?? [])]);
    this.attributePackagingDraft.set(article.packaging ?? '');
    this.attributeUpdateError.set('');
    this.attributeFieldErrors.set({});
  }

  private invalidateDetailRequest(): void {
    this.detailRequestId += 1;
    this.attributeRequestId += 1;
    this.lookingUp.set(false);
    this.updatingAttributes.set(false);
  }

  private setPriceUpdateError(message: string, fieldMessage: string): void {
    this.priceUpdateError.set(message);
    this.priceHtFieldError.set(fieldMessage);
  }

  private focusPriceUpdate(): void {
    document.getElementById('detailPriceHtCents')?.focus();
  }

  private focusAttributeError(): void {
    const field = Object.keys(this.attributeFieldErrors())[0];
    const target = field === 'consumptionModes'
      ? document.querySelector<HTMLElement>('#detailConsumptionModes input')
      : field === 'name'
        ? document.getElementById('detailName')
        : field === 'dlc'
          ? document.getElementById('detailDlc')
          : field === 'packaging'
            ? document.getElementById('detailPackaging')
            : document.getElementById('attribute-update-error');
    target?.focus();
  }

  private focusSupplyError(): void {
    const field = Object.keys(this.supplyFieldErrors())[0];
    const target = field === 'ean13'
      ? document.getElementById('supplyEan13')
      : field === 'quantity'
        ? document.getElementById('supplyQuantity')
        : document.getElementById('supply-status');
    target?.focus();
  }
}
