import { HttpErrorResponse } from '@angular/common/http';
import { AfterViewInit, ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  FieldTree,
  FormField,
  FormRoot,
  TreeValidationResult,
  applyEach,
  form,
  hidden,
  pattern,
  required,
  submit,
} from '@angular/forms/signals';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  BulkSupplyPayload,
  SupplyPayload,
} from './stock-api.service';
import { DashboardComponent } from './dashboard.component';
import {
  InventoryApiService,
  BulkInventoryResponse,
  InventoryResponse,
  InventoryOperationLineResponse,
} from './inventory-api.service';
import {
  CounterMovementApiService,
  CounterMovementFinancialResponse,
  CounterMovementResponse,
  CounterMovementSource,
  CounterMovementReason,
  CounterMovementAvailability,
  CounterMovementSourceType,
} from './counter-movement-api.service';
import {
  SaleArticleResponse,
  SalePayload,
  SaleResponse,
  SalesApiService,
} from './sales-api.service';
import {
  HistoryApiService,
  HistoryEntryResponse,
  HistoryEntryType,
} from './history-api.service';

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

interface SupplyLineFormModel {
  ean13: string;
  quantity: string;
}

interface InventoryFormModel {
  ean13: string;
  countedQuantity: string;
}

interface InventoryBulkFormModel {
  lines: InventoryFormModel[];
}

interface CounterMovementFormModel {
  sourceOperationId: string;
  justification: string;
}

type InventoryReceiptResponse = InventoryResponse | BulkInventoryResponse;

interface InventoryDisplayLine {
  lineNumber: number;
  ean13: string;
  previousPhysicalStock: number;
  countedQuantity: number;
  inventoryDifference: number;
  resultingPhysicalStock: number;
  position: NonNullable<InventoryOperationLineResponse['position']>;
}

type CatalogState = 'loading' | 'ready' | 'empty' | 'error';
type CatalogType = ArticleType | 'all';
type StockState = 'loading' | 'ready' | 'empty' | 'error';
type InventoryRestoreState = 'loading' | 'ready' | 'empty' | 'error';
type CounterMovementSourcesState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
type SaleSearchState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
type SaleState = 'ready' | 'loading' | 'validation' | 'conflict' | 'error' | 'success';
type HistoryState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

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
const lastSaleIdStorageKey = 'token-warehouse.last-sale-id';
const routeSectionTargetIds: Record<string, string> = {
  dashboard: 'dashboard-title',
  catalogue: 'catalog-title',
  stock: 'stock-title',
  approvisionnements: 'supply-title',
  inventaires: 'inventory-title',
  corrections: 'counter-movement-title',
  historique: 'history-title',
  ventes: 'sale-title',
};

@Component({
  selector: 'app-legacy-backoffice-page',
  standalone: true,
  imports: [DashboardComponent, FormField, FormRoot],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main aria-labelledby="page-title">
      <header class="page-header">
        <p class="eyebrow">Catalogue d’Articles</p>
        <h1 id="page-title">Créer et consulter un Article</h1>
        <p>Une référence EAN-13, un Prix HT en centimes et les attributs de sa classification.</p>
      </header>

      <app-dashboard />

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

      <section id="sale-panel" class="panel" aria-labelledby="sale-title">
        <div>
          <p class="eyebrow">Mouvement immédiat</p>
          <h2 id="sale-title">Enregistrer une Vente</h2>
        </div>
        <p>Recherchez un Article actif, vérifiez le Stock vendable, puis validez une quantité entière.</p>

        <form id="sale-search-form" class="catalog-filters" (submit)="onSaleSearchSubmit($event)">
          <label for="sale-search">Rechercher par nom ou EAN-13</label>
          <input
            id="sale-search"
            autocomplete="off"
            inputmode="search"
            placeholder="Nom ou EAN-13"
            [value]="saleSearch()"
            (input)="setSaleSearch($event)" />
          <button type="submit" [disabled]="saleSearchState() === 'loading'">
            {{ saleSearchState() === 'loading' ? 'Recherche…' : 'Rechercher un Article' }}
          </button>
        </form>

        <div id="sale-search-state" class="catalog-state" aria-live="polite" role="status">
          @switch (saleSearchState()) {
            @case ('idle') {
              <p>Saisissez un nom ou un EAN-13 pour sélectionner un Article.</p>
            }
            @case ('loading') {
              <p>Chargement des Articles vendables…</p>
            }
            @case ('ready') {
              <p>{{ saleArticles().length }} Article{{ saleArticles().length > 1 ? 's' : '' }} trouvé{{ saleArticles().length > 1 ? 's' : '' }}.</p>
            }
            @case ('empty') {
              <p>Aucun Article ne correspond à cette recherche.</p>
            }
            @case ('error') {
              <p class="form-error" role="alert">{{ saleSearchError() }}</p>
              <button type="button" class="secondary-button" (click)="retrySaleSearch()">Réessayer</button>
            }
          }
        </div>

        @if (saleArticles().length > 0) {
          <div class="table-wrap">
            <table id="sale-articles-table">
              <caption class="sr-only">Articles disponibles pour une Vente</caption>
              <thead>
                <tr>
                  <th scope="col">Article</th>
                  <th scope="col">EAN-13</th>
                  <th scope="col">Type</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Prix HT</th>
                  <th scope="col">Stock physique</th>
                  <th scope="col">Stock vendable</th>
                  <th scope="col">Disponibilité</th>
                  <th scope="col">Devis TTC</th>
                  <th scope="col"><span class="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                @for (article of saleArticles(); track article.ean13) {
                  <tr>
                    <th scope="row">{{ article.name }}</th>
                    <td>{{ article.ean13 }}</td>
                    <td>{{ article.type === 'food' ? 'Alimentaire' : 'Non alimentaire' }}</td>
                    <td>{{ article.isActive ? 'Actif' : 'Archivé' }}</td>
                    <td>{{ article.priceHtCents }} centimes</td>
                    <td>{{ article.physicalQuantity }} unités</td>
                    <td>{{ article.sellableQuantity }} unités</td>
                    <td>{{ formatStockAvailability(article.availability) }}</td>
                    <td>
                      @for (quote of article.priceQuotes ?? []; track quote.saleContext ?? quote.taxRate.code) {
                        <div>{{ quote.saleContext === 'takeaway' ? 'À emporter' : quote.saleContext === 'onsite' ? 'Sur place' : 'Non alimentaire' }} : {{ quote.priceTtcCents }} centimes</div>
                      }
                    </td>
                    <td>
                      <button
                        type="button"
                        class="table-action"
                        [attr.aria-pressed]="selectedSaleArticle()?.ean13 === article.ean13"
                        [attr.aria-label]="'Sélectionner ' + article.name"
                        (click)="selectSaleArticle(article)">
                        {{ selectedSaleArticle()?.ean13 === article.ean13 ? 'Sélectionné' : 'Sélectionner' }}
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        @if (selectedSaleArticle(); as article) {
          <article id="sale-selection" class="stock-detail" role="region" aria-labelledby="sale-selection-title" tabindex="-1">
            <h3 id="sale-selection-title">Article sélectionné — {{ article.name }}</h3>
            <dl>
              <div><dt>EAN-13</dt><dd>{{ article.ean13 }}</dd></div>
              <div><dt>Type</dt><dd>{{ article.type === 'food' ? 'Alimentaire' : 'Non alimentaire' }}</dd></div>
              <div><dt>Statut</dt><dd>{{ article.isActive ? 'Actif' : 'Archivé' }}</dd></div>
              <div><dt>Prix HT</dt><dd>{{ article.priceHtCents }} centimes</dd></div>
              <div><dt>Stock physique</dt><dd>{{ article.physicalQuantity }} unités</dd></div>
              <div><dt>Stock vendable</dt><dd>{{ article.sellableQuantity }} unités</dd></div>
            </dl>

            @if (article.type === 'food' && (article.consumptionModes?.length ?? 0) > 1) {
              <fieldset
                id="sale-context"
                aria-describedby="sale-context-error"
                [attr.aria-invalid]="saleFieldError('context') ? 'true' : null">
                <legend>Contexte de Vente</legend>
                @for (mode of article.consumptionModes ?? []; track mode) {
                  <label [attr.for]="'sale-context-' + mode">
                    <input
                      [id]="'sale-context-' + mode"
                      type="radio"
                      name="sale-context"
                      [value]="mode"
                      [checked]="saleContext() === mode"
                      (change)="setSaleContext($event)" />
                    {{ mode === 'takeaway' ? 'À emporter' : 'Sur place' }}
                  </label>
                }
                <span id="sale-context-error" class="field-error">{{ saleFieldError('context') }}</span>
              </fieldset>
            } @else if (article.type === 'food' && (article.consumptionModes?.length ?? 0) === 1) {
              <p id="sale-context-derived" role="status">
                Contexte déduit : {{ article.consumptionModes?.[0] === 'takeaway' ? 'À emporter' : 'Sur place' }}.
              </p>
            } @else {
              <p id="sale-context-none">Aucun Contexte de Vente — TVA non alimentaire.</p>
            }

            <section id="sale-pricing-preview" aria-labelledby="sale-pricing-preview-title">
              <h4 id="sale-pricing-preview-title">Devis tarifaire serveur</h4>
              @for (quote of article.priceQuotes ?? []; track quote.saleContext ?? quote.taxRate.code) {
                <dl class="price-quote">
                  @if (quote.saleContext) {
                    <div>
                      <dt>Contexte</dt>
                      <dd>{{ quote.saleContext === 'takeaway' ? 'À emporter' : 'Sur place' }}</dd>
                    </div>
                  }
                  <div><dt>Taux de TVA</dt><dd>{{ quote.taxRate.ratio }}</dd></div>
                  <div><dt>Prix TTC unitaire</dt><dd>{{ quote.priceTtcCents }} centimes</dd></div>
                </dl>
              }
            </section>

            <form id="sale-form" class="lookup" novalidate (submit)="onSaleSubmit($event)">
              <label for="sale-quantity">
                Quantité entière positive
                <input
                  id="sale-quantity"
                  type="number"
                  min="1"
                  step="1"
                  inputmode="numeric"
                  [value]="saleQuantity()"
                  [attr.aria-invalid]="saleFieldError('quantity') ? 'true' : null"
                  aria-describedby="sale-quantity-error"
                  (input)="setSaleQuantity($event)" />
                <span id="sale-quantity-error" class="field-error">{{ saleFieldError('quantity') }}</span>
              </label>
              <button id="sale-submit" type="submit" [disabled]="saleSubmitting()">
                {{ saleSubmitting() ? 'Validation…' : 'Enregistrer la Vente' }}
              </button>
            </form>
          </article>
        }

        <p id="sale-status" role="status" aria-live="assertive" tabindex="-1">{{ saleStatusMessage() }}</p>

        @if (saleReceipt(); as receipt) {
          <article id="sale-result" class="stock-detail" role="region" aria-labelledby="sale-result-title" tabindex="-1">
            <h3 id="sale-result-title">Vente engagée</h3>
            <dl>
              <div><dt>Identifiant d’opération</dt><dd><code>{{ receipt.operation.id }}</code></dd></div>
              <div><dt>Horodatage UTC</dt><dd>{{ receipt.operation.occurredAt }}</dd></div>
              <div><dt>EAN-13</dt><dd>{{ receipt.operation.ean13 }}</dd></div>
              <div><dt>Quantité</dt><dd>{{ receipt.operation.quantity }} unités</dd></div>
              <div><dt>Prix HT unitaire</dt><dd>{{ receipt.financial.unitPriceHtCents }} centimes</dd></div>
              <div><dt>Taux de TVA</dt><dd>{{ receipt.financial.taxRate.ratio }}</dd></div>
              <div><dt>Montant HT</dt><dd>{{ receipt.financial.amountHtCents }} centimes</dd></div>
              <div><dt>TVA</dt><dd>{{ receipt.financial.vatCents }} centimes</dd></div>
              <div><dt>Montant TTC</dt><dd>{{ receipt.financial.amountTtcCents }} centimes</dd></div>
              <div><dt>Stock physique résultant</dt><dd>{{ receipt.position.physicalQuantity }} unités</dd></div>
              <div><dt>Stock vendable résultant</dt><dd>{{ receipt.position.sellableQuantity }} unités</dd></div>
            </dl>
          </article>
        }
      </section>

      <section id="history-panel" class="panel" aria-labelledby="history-title">
        <div>
          <p class="eyebrow">Lecture immuable</p>
          <h2 id="history-title">Historique</h2>
        </div>
        <p>Les faits engagés sont présentés du plus récent au plus ancien, sans recalculer le Stock courant.</p>

        <form id="history-filter-form" class="lookup" (submit)="onHistorySubmit($event)">
          <label for="history-ean13">Filtrer par EAN-13</label>
          <input
            id="history-ean13"
            autocomplete="off"
            inputmode="numeric"
            pattern="[0-9]{13}"
            [value]="historyFilterEan()"
            (input)="setHistoryFilter($event)" />
          <button type="submit" [disabled]="historyState() === 'loading'">Filtrer l’Historique</button>
          <button type="button" class="secondary-button" (click)="loadHistory('')">Historique global</button>
        </form>

        <div id="history-state" class="catalog-state" role="status" aria-live="polite">
          @switch (historyState()) {
            @case ('idle') { <p>Consultez l’Historique global ou filtrez par Article.</p> }
            @case ('loading') { <p>Chargement de l’Historique…</p> }
            @case ('ready') { <p>{{ historyEntries().length }} fait{{ historyEntries().length > 1 ? 's' : '' }} trouvé{{ historyEntries().length > 1 ? 's' : '' }}.</p> }
            @case ('empty') { <p>Aucun fait historique ne correspond à cette requête.</p> }
            @case ('error') {
              <p class="form-error" role="alert">{{ historyError() }}</p>
              <button type="button" class="secondary-button" (click)="retryHistory()">Réessayer</button>
            }
          }
        </div>

        @if (historyEntries().length > 0) {
          <div id="history-list" class="history-list">
            @for (entry of historyEntries(); track entry.id) {
              <article class="history-entry" [attr.aria-labelledby]="'history-entry-' + entry.id">
                <h3 [id]="'history-entry-' + entry.id">
                  {{ formatHistoryType(entry.type) }} — {{ entry.timestampUtc }}
                </h3>
                <dl>
                  <div><dt>Identifiant</dt><dd><code>{{ entry.id }}</code></dd></div>
                  <div><dt>Article(s)</dt><dd>{{ formatHistoryArticles(entry) }}</dd></div>
                  @if (entry.quantity !== undefined) { <div><dt>Quantité utile</dt><dd>{{ entry.quantity }} unités</dd></div> }
                  @if (entry.stockEffect !== undefined) { <div><dt>Effet Stock</dt><dd>{{ formatHistoryEffect(entry.stockEffect) }}</dd></div> }
                  @if (entry.type !== 'COUNTER_MOVEMENT' && entry.previousPhysicalStock !== undefined) { <div><dt>Stock physique précédent</dt><dd>{{ entry.previousPhysicalStock }} unités</dd></div> }
                  @if (entry.countedQuantity !== undefined) { <div><dt>Quantité comptée</dt><dd>{{ entry.countedQuantity }} unités</dd></div> }
                  @if (entry.difference !== undefined) { <div><dt>Écart</dt><dd>{{ formatHistoryEffect(entry.difference) }}</dd></div> }
                  @if (entry.resultingPhysicalStock !== undefined) { <div><dt>Stock physique résultant</dt><dd>{{ entry.resultingPhysicalStock }} unités</dd></div> }
                  @if (entry.sourceOperationId) { <div><dt>Source</dt><dd><code>{{ entry.sourceOperationId }}</code> — {{ entry.sourceOperationType }}</dd></div> }
                  @if (entry.correctionOperationId) { <div><dt>Correction</dt><dd><code>{{ entry.correctionOperationId }}</code></dd></div> }
                  @if (entry.correctedByOperationId) { <div><dt>Corrigé par</dt><dd><code>{{ entry.correctedByOperationId }}</code></dd></div> }
                  @if (entry.justification) { <div><dt>Justification</dt><dd>{{ entry.justification }}</dd></div> }
                  @if (entry.financial; as financial) {
                    <div><dt>Prix HT unitaire historique</dt><dd>{{ financial.unitPriceHtCents }} centimes</dd></div>
                    <div><dt>Contexte historique</dt><dd>{{ financial.context === 'takeaway' ? 'À emporter' : financial.context === 'onsite' ? 'Sur place' : 'Non alimentaire' }}</dd></div>
                    <div><dt>Taux de TVA historique</dt><dd>{{ financial.taxRate.ratio }}</dd></div>
                    <div><dt>Montant HT historique</dt><dd>{{ financial.amountHtCents }} centimes</dd></div>
                    <div><dt>TVA historique</dt><dd>{{ financial.vatCents }} centimes</dd></div>
                    <div><dt>Montant TTC historique</dt><dd>{{ financial.amountTtcCents }} centimes</dd></div>
                  }
                  @if (entry.financialReversal; as reversal) {
                    <div><dt>Prix HT unitaire historique</dt><dd>{{ reversal.unitPriceHtCents }} centimes</dd></div>
                    <div><dt>Contexte historique</dt><dd>{{ formatCounterMovementFinancialContext(reversal.context) }}</dd></div>
                    <div><dt>Taux de TVA historique</dt><dd>{{ reversal.taxRate.ratio }}</dd></div>
                    <div><dt>Inversion financière HT</dt><dd>{{ formatCounterMovementEffect(reversal.amountHtCents) }} centimes</dd></div>
                    <div><dt>Inversion financière TVA</dt><dd>{{ formatCounterMovementEffect(reversal.vatCents) }} centimes</dd></div>
                    <div><dt>Inversion financière TTC</dt><dd>{{ formatCounterMovementEffect(reversal.amountTtcCents) }} centimes</dd></div>
                  }
                  @if (entry.previousStatus || entry.nextStatus) { <div><dt>Cycle de vie</dt><dd>{{ entry.previousStatus }} → {{ entry.nextStatus }}</dd></div> }
                </dl>

                @if (entry.changes?.length) {
                  <ul aria-label="Valeurs modifiées">
                    @for (change of entry.changes; track change.field) {
                      <li>{{ change.field }} : {{ change.before ?? change.previousValue ?? '—' }} → {{ change.after ?? change.nextValue ?? '—' }}</li>
                    }
                  </ul>
                }

                @if (entry.lines.length > 0) {
                  <h4>Lignes</h4>
                  <ul aria-label="Lignes de l’opération">
                    @for (line of entry.lines; track line.lineNumber) {
                      <li>
                        Ligne {{ line.lineNumber }} — {{ line.ean13 }}
                        @if (line.quantity !== undefined) { · {{ line.quantity }} unités }
                        @if (line.stockEffect !== undefined) { · effet {{ formatHistoryEffect(line.stockEffect) }} }
                        @if (line.inverseEffect !== undefined) { · effet inverse {{ formatHistoryEffect(line.inverseEffect) }} }
                        @if (line.countedQuantity !== undefined) { · comptée {{ line.countedQuantity }} }
                        @if (line.difference !== undefined) { · écart {{ formatHistoryEffect(line.difference) }} }
                        @if (line.resultingPhysicalStock !== undefined) { · résultat {{ line.resultingPhysicalStock }} }
                      </li>
                    }
                  </ul>
                }
              </article>
            }
          </div>
        }
      </section>

      <section id="supply-panel" class="panel" aria-labelledby="supply-title">
        <div>
          <p class="eyebrow">Mouvement immédiat</p>
          <h2 id="supply-title">Enregistrer un Approvisionnement</h2>
        </div>
        <p>La position visible est remplacée par le résultat engagé par le serveur après la réception.</p>

        <form id="supply-form" class="supply-form" novalidate (submit)="onSupplySubmit($event)">
          @for (line of supplyLines(); track $index; let lineIndex = $index) {
            <fieldset class="supply-line" [attr.aria-labelledby]="supplyLineTitleId(lineIndex)">
              <legend [id]="supplyLineTitleId(lineIndex)">Ligne {{ lineIndex + 1 }}</legend>
              <label [attr.for]="supplyInputId('ean13', lineIndex)">
                Référence EAN-13
                <input
                  [id]="supplyInputId('ean13', lineIndex)"
                  autocomplete="off"
                  inputmode="numeric"
                  pattern="[0-9]{13}"
                  [value]="line.ean13"
                  [attr.aria-invalid]="supplyLineFieldError(lineIndex, 'ean13') ? 'true' : null"
                  [attr.aria-describedby]="supplyErrorId('ean13', lineIndex)"
                  (input)="setSupplyLineField(lineIndex, 'ean13', $event)"
                  />
                <span [id]="supplyErrorId('ean13', lineIndex)" class="field-error">{{ supplyLineFieldError(lineIndex, 'ean13') }}</span>
              </label>

              <label [attr.for]="supplyInputId('quantity', lineIndex)">
                Quantité entière positive
                <input
                  [id]="supplyInputId('quantity', lineIndex)"
                  type="number"
                  min="1"
                  step="1"
                  inputmode="numeric"
                  [value]="line.quantity"
                  [attr.aria-invalid]="supplyLineFieldError(lineIndex, 'quantity') ? 'true' : null"
                  [attr.aria-describedby]="supplyErrorId('quantity', lineIndex)"
                  (input)="setSupplyLineField(lineIndex, 'quantity', $event)"
                  />
                <span [id]="supplyErrorId('quantity', lineIndex)" class="field-error">{{ supplyLineFieldError(lineIndex, 'quantity') }}</span>
              </label>

              @if (supplyLines().length > 1) {
                <button
                  type="button"
                  class="secondary-button"
                  [attr.aria-label]="'Retirer la ligne ' + (lineIndex + 1)"
                  (click)="removeSupplyLine(lineIndex)">
                  Retirer
                </button>
              }
            </fieldset>
          }

          <button type="button" class="secondary-button" (click)="addSupplyLine()">Ajouter une ligne</button>
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
        <p>Comptez une ou plusieurs Références EAN-13 pour établir de nouvelles bases de Stock physique.</p>

        <form id="inventory-form" class="form-grid" novalidate [formRoot]="inventoryBulkForm" (submit)="onInventorySubmit($event)">
          @for (line of inventoryBulkForm.lines; track line; let index = $index) {
            <fieldset class="inventory-line">
              <legend>Ligne {{ index + 1 }}</legend>
              <label>
                Référence EAN-13
                <input
                  [id]="inventoryFieldId('ean13', index)"
                  autocomplete="off"
                  inputmode="numeric"
                  [formField]="line.ean13"
                  (input)="setInventoryEan(index, $event)"
                  [attr.aria-describedby]="inventoryErrorDescription(index, 'ean13')" />
                @if (inventoryLineError(index, 'ean13'); as error) {
                  <span [id]="inventoryErrorId('ean13', index)" class="field-error">{{ error }}</span>
                }
              </label>

              <label>
                Quantité comptée
                <input
                  [id]="inventoryFieldId('countedQuantity', index)"
                  type="text"
                  step="1"
                  inputmode="numeric"
                  [formField]="line.countedQuantity"
                  (input)="setInventoryCountedQuantity(index, $event)"
                  [attr.aria-describedby]="inventoryErrorDescription(index, 'countedQuantity')" />
                @if (inventoryLineError(index, 'countedQuantity'); as error) {
                  <span [id]="inventoryErrorId('countedQuantity', index)" class="field-error">{{ error }}</span>
                }
              </label>

              @if (inventoryBulkForm.lines.length > 1) {
                <button
                  type="button"
                  class="secondary-button"
                  [attr.aria-label]="'Retirer la ligne ' + (index + 1)"
                  (click)="removeInventoryLine(index)">
                  Retirer
                </button>
              }
            </fieldset>
          }

          <button id="inventory-add-line" type="button" class="secondary-button" (click)="addInventoryLine()">
            Ajouter une ligne
          </button>

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
            <p>Identifiant serveur : <code>{{ receipt.operation.id }}</code></p>
            @for (line of receiptLines(receipt); track line.lineNumber) {
              <section class="inventory-result-line" [attr.aria-labelledby]="'inventory-result-line-title-' + line.lineNumber">
                <h4 [id]="'inventory-result-line-title-' + line.lineNumber">Ligne {{ line.lineNumber }} — {{ line.ean13 }}</h4>
                <dl>
                  <div><dt>EAN-13</dt><dd>{{ line.ean13 }}</dd></div>
                  <div><dt>Stock physique précédent</dt><dd>{{ line.previousPhysicalStock }} unités</dd></div>
                  <div><dt>Quantité comptée</dt><dd>{{ line.countedQuantity }} unités</dd></div>
                  <div><dt>Écart d’inventaire</dt><dd>{{ formatInventoryDifference(line.inventoryDifference) }}</dd></div>
                  <div><dt>Nouvelle base physique</dt><dd>{{ line.resultingPhysicalStock }} unités</dd></div>
                  <div><dt>Stock vendable</dt><dd>{{ line.position.sellableStock }} unités</dd></div>
                  <div><dt>Disponibilité</dt><dd>{{ formatStockAvailability(line.position.availability) }}</dd></div>
                  <div><dt>Raison</dt><dd>{{ formatStockReason(line.position.reason) }}</dd></div>
                  <div><dt>Timestamp UTC</dt><dd>{{ receipt.operation.timestampUtc }}</dd></div>
                </dl>
              </section>
            }
          </article>
        }
      </section>

      <section id="counter-movement-panel" class="panel" aria-labelledby="counter-movement-title">
        <div>
          <p class="eyebrow">Correction traçable</p>
          <h2 id="counter-movement-title">Corriger une Opération</h2>
        </div>
        <p>La source reste inchangée ; le serveur applique son effet inverse à la position courante.</p>

        <button
          id="counter-movement-load"
          type="button"
          class="secondary-button"
          [disabled]="counterMovementSourcesState() === 'loading'"
          (click)="loadCounterMovementSources()">
          {{ counterMovementSourcesState() === 'loading' ? 'Chargement…' : 'Charger les Opérations corrigeables' }}
        </button>

        <div id="counter-movement-sources-state" role="status" aria-live="polite">
          @switch (counterMovementSourcesState()) {
            @case ('loading') { <p>Chargement des Opérations corrigeables…</p> }
            @case ('empty') { <p>Aucune Opération corrigeable n’est disponible.</p> }
            @case ('error') { <p class="form-error" role="alert">{{ counterMovementError() }}</p> }
          }
        </div>

        @if (counterMovementSources().length > 0) {
          <form id="counter-movement-form" class="form-grid" novalidate [formRoot]="counterMovementForm" (submit)="onCounterMovementSubmit($event)">
            <label for="counter-movement-source">
              Opération source
              <select
                id="counter-movement-source"
                [formField]="counterMovementForm.sourceOperationId"
                [attr.aria-invalid]="counterMovementFieldError('sourceOperationId') ? 'true' : null"
                [attr.aria-describedby]="counterMovementErrorId('sourceOperationId')"
                (input)="clearCounterMovementField('sourceOperationId')">
                <option value="">Choisir une Opération</option>
                @for (source of counterMovementSources(); track source.id) {
                  <option [value]="source.id">
                    {{ formatCounterMovementSourceType(source.type) }} — {{ source.id }} — {{ source.timestampUtc }}
                  </option>
                }
              </select>
              @if (counterMovementFieldError('sourceOperationId'); as error) {
                <span id="counter-movement-sourceOperationId-error" class="field-error">{{ error }}</span>
              }
            </label>

            @if (selectedCounterMovementSource(); as source) {
              <article class="stock-detail" aria-labelledby="counter-movement-source-title">
                <h3 id="counter-movement-source-title">Source {{ source.id }}</h3>
                <dl>
                  <div><dt>Type</dt><dd>{{ formatCounterMovementSourceType(source.type) }}</dd></div>
                  <div><dt>Timestamp UTC</dt><dd>{{ source.timestampUtc }}</dd></div>
                  @if (source.financial; as financial) {
                    <div><dt>Prix HT unitaire historique</dt><dd>{{ financial.unitPriceHtCents }} centimes</dd></div>
                    <div><dt>Contexte historique</dt><dd>{{ formatCounterMovementFinancialContext(financial.context) }}</dd></div>
                    <div><dt>Taux de TVA historique</dt><dd>{{ financial.taxRate.ratio }}</dd></div>
                    <div><dt>Montant HT historique</dt><dd>{{ financial.amountHtCents }} centimes</dd></div>
                    <div><dt>TVA historique</dt><dd>{{ financial.vatCents }} centimes</dd></div>
                    <div><dt>Montant TTC historique</dt><dd>{{ financial.amountTtcCents }} centimes</dd></div>
                  }
                  @for (line of source.lines; track line.lineNumber) {
                    <div><dt>Ligne {{ line.lineNumber }} — {{ line.ean13 }}</dt><dd>{{ formatCounterMovementEffect(line.stockEffect) }}</dd></div>
                  }
                </dl>
              </article>
            }

            <label for="counter-movement-justification">
              Justification
              <textarea
                id="counter-movement-justification"
                rows="3"
                [formField]="counterMovementForm.justification"
                [attr.aria-invalid]="counterMovementFieldError('justification') ? 'true' : null"
                [attr.aria-describedby]="counterMovementErrorId('justification')"
                (input)="clearCounterMovementField('justification')"></textarea>
              @if (counterMovementFieldError('justification'); as error) {
                <span id="counter-movement-justification-error" class="field-error">{{ error }}</span>
              }
            </label>

            <button id="counter-movement-submit" type="submit" [disabled]="counterMovementSubmitting()">
              {{ counterMovementSubmitting() ? 'Correction…' : 'Enregistrer le Contre-mouvement' }}
            </button>
          </form>
        }

        @if (counterMovementError() && counterMovementSourcesState() !== 'error') {
          <p id="counter-movement-error" class="form-error" role="alert" aria-live="assertive" tabindex="-1">{{ counterMovementError() }}</p>
        }

        @if (counterMovementReceipt(); as receipt) {
          <article id="counter-movement-result" class="stock-detail" role="region" aria-live="polite" aria-labelledby="counter-movement-result-title" tabindex="-1">
            <h3 id="counter-movement-result-title">Contre-mouvement enregistré</h3>
            <dl>
              <div><dt>Correction</dt><dd><code>{{ receipt.counterMovement.id }}</code></dd></div>
              <div><dt>Source</dt><dd><code>{{ receipt.counterMovement.sourceOperationId }}</code> — {{ receipt.counterMovement.sourceOperationType }}</dd></div>
              <div><dt>Justification</dt><dd>{{ receipt.counterMovement.justification }}</dd></div>
              <div><dt>Timestamp UTC</dt><dd>{{ receipt.counterMovement.timestampUtc }}</dd></div>
            </dl>
            @if (receipt.financialReversal; as reversal) {
              <section class="inventory-result-line" aria-labelledby="counter-movement-financial-title">
                <h4 id="counter-movement-financial-title">Effet financier inverse</h4>
                <dl>
                  <div><dt>Vente source</dt><dd><code>{{ reversal.sourceOperationId }}</code></dd></div>
                  <div><dt>Contexte historique</dt><dd>{{ formatCounterMovementFinancialContext(reversal.context) }}</dd></div>
                  <div><dt>Taux de TVA historique</dt><dd>{{ reversal.taxRate.ratio }}</dd></div>
                  <div><dt>Montant HT</dt><dd>{{ formatCounterMovementEffect(reversal.amountHtCents) }} centimes</dd></div>
                  <div><dt>TVA</dt><dd>{{ formatCounterMovementEffect(reversal.vatCents) }} centimes</dd></div>
                  <div><dt>Montant TTC</dt><dd>{{ formatCounterMovementEffect(reversal.amountTtcCents) }} centimes</dd></div>
                </dl>
              </section>
            }
            @for (line of receipt.counterMovement.lines; track line.lineNumber) {
              <section class="inventory-result-line" [attr.aria-labelledby]="'counter-movement-result-line-' + line.lineNumber">
                <h4 [id]="'counter-movement-result-line-' + line.lineNumber">Ligne {{ line.lineNumber }} — {{ line.ean13 }}</h4>
                <dl>
                  <div><dt>Effet source</dt><dd>{{ formatCounterMovementEffect(line.sourceEffect) }}</dd></div>
                  <div><dt>Effet inverse</dt><dd>{{ formatCounterMovementEffect(line.inverseEffect) }}</dd></div>
                  @if (counterMovementPosition(receipt, line.ean13); as position) {
                    <div><dt>Stock physique</dt><dd>{{ position.physicalStock }} unités</dd></div>
                    <div><dt>Stock vendable</dt><dd>{{ position.sellableStock }} unités</dd></div>
                    <div><dt>Disponibilité</dt><dd>{{ formatCounterMovementAvailability(position.availability) }}</dd></div>
                    <div><dt>Raison</dt><dd>{{ formatCounterMovementReason(position.reason) }}</dd></div>
                  }
                </dl>
              </section>
            }
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

            <section id="article-history-panel" aria-labelledby="article-history-title" tabindex="-1">
              <h4 id="article-history-title">Historique de l’Article</h4>
              <button type="button" class="secondary-button" [disabled]="articleHistoryState() === 'loading'" (click)="loadArticleHistory(article.ean13)">
                {{ articleHistoryState() === 'loading' ? 'Chargement…' : 'Consulter l’Historique de cet Article' }}
              </button>
              <div id="article-history-state" role="status" aria-live="polite">
                @switch (articleHistoryState()) {
                  @case ('loading') { <p>Chargement de l’Historique de l’Article…</p> }
                  @case ('empty') { <p>Aucun fait historique pour cet Article.</p> }
                  @case ('error') { <p class="form-error" role="alert">{{ articleHistoryError() }}</p> }
                  @case ('ready') { <p>{{ articleHistoryEntries().length }} fait{{ articleHistoryEntries().length > 1 ? 's' : '' }} trouvé{{ articleHistoryEntries().length > 1 ? 's' : '' }}.</p> }
                }
              </div>
              @if (articleHistoryEntries().length > 0 && articleHistoryEan() === article.ean13) {
                <div id="article-history-list" class="history-list">
                  @for (entry of articleHistoryEntries(); track entry.id) {
                    <article class="history-entry" [attr.aria-labelledby]="'article-history-entry-' + entry.id">
                      <h5 [id]="'article-history-entry-' + entry.id">{{ formatHistoryType(entry.type) }} — {{ entry.timestampUtc }}</h5>
                      <p>{{ formatHistoryArticles(entry) }}</p>
                      @if (entry.countedQuantity !== undefined) { <p>Quantité comptée : {{ entry.countedQuantity }} ; Écart : {{ formatHistoryEffect(entry.difference) }}</p> }
                      @if (entry.stockEffect !== undefined) { <p>Effet Stock : {{ formatHistoryEffect(entry.stockEffect) }} ; résultat : {{ entry.resultingPhysicalStock }} unités</p> }
                      @if (entry.previousStatus || entry.nextStatus) { <p>Cycle de vie : {{ entry.previousStatus }} → {{ entry.nextStatus }}</p> }
                      @if (entry.sourceOperationId) { <p>Source : <code>{{ entry.sourceOperationId }}</code> ; justification : {{ entry.justification }}</p> }
                      @if (entry.correctionOperationId) { <p>Correction : <code>{{ entry.correctionOperationId }}</code></p> }
                      @if (entry.correctedByOperationId) { <p>Corrigé par : <code>{{ entry.correctedByOperationId }}</code></p> }
                      @if (entry.financial; as financial) {
                        <p>Prix HT unitaire historique : {{ financial.unitPriceHtCents }} centimes ; Contexte {{ formatCounterMovementFinancialContext(financial.context) }} ; Taux : {{ financial.taxRate.ratio }} ; Montant HT : {{ financial.amountHtCents }} ; TVA : {{ financial.vatCents }} ; TTC : {{ financial.amountTtcCents }}.</p>
                      }
                      @if (entry.financialReversal; as reversal) {
                        <p>Inversion financière : Prix HT unitaire historique {{ reversal.unitPriceHtCents }} centimes ; Contexte {{ formatCounterMovementFinancialContext(reversal.context) }} ; Taux {{ reversal.taxRate.ratio }} ; HT {{ formatCounterMovementEffect(reversal.amountHtCents) }} ; TVA {{ formatCounterMovementEffect(reversal.vatCents) }} ; TTC {{ formatCounterMovementEffect(reversal.amountTtcCents) }} centimes.</p>
                      }
                      @if (entry.lines.length > 0) {
                        <ul aria-label="Lignes de l’opération">
                          @for (line of entry.lines; track line.lineNumber) {
                            <li>
                              Ligne {{ line.lineNumber }} — {{ line.ean13 }}
                              @if (line.quantity !== undefined) { · {{ line.quantity }} unités }
                              @if (line.stockEffect !== undefined) { · effet {{ formatHistoryEffect(line.stockEffect) }} }
                              @if (line.inverseEffect !== undefined) { · effet inverse {{ formatHistoryEffect(line.inverseEffect) }} }
                              @if (entry.type !== 'COUNTER_MOVEMENT' && line.previousPhysicalStock !== undefined) { · précédent {{ line.previousPhysicalStock }} }
                              @if (line.countedQuantity !== undefined) { · comptée {{ line.countedQuantity }} }
                              @if (line.difference !== undefined) { · écart {{ formatHistoryEffect(line.difference) }} }
                              @if (line.resultingPhysicalStock !== undefined) { · résultat {{ line.resultingPhysicalStock }} }
                            </li>
                          }
                        </ul>
                      }
                      @if (entry.changes?.length) {
                        <ul>
                          @for (change of entry.changes; track change.field) {
                            <li>{{ change.field }} : {{ change.before ?? change.previousValue ?? '—' }} → {{ change.after ?? change.nextValue ?? '—' }}</li>
                          }
                        </ul>
                      }
                    </article>
                  }
                </div>
              }
            </section>
          </article>
        }
      </section>
    </main>
  `,
})
export class LegacyBackofficePage implements AfterViewInit, OnInit {
  private readonly router = inject(Router, { optional: true });

  private readonly api = inject(ArticleApiService);
  private readonly stockApi = inject(StockApiService);
  private readonly inventoryApi = inject(InventoryApiService);
  private readonly counterMovementApi = inject(CounterMovementApiService);
  private readonly salesApi = inject(SalesApiService);
  private readonly historyApi = inject(HistoryApiService);

  constructor() {
    this.router?.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.openCurrentRouteSection();
      }
    });
  }

  readonly model = signal<ArticleFormModel>({ ...initialModel, consumptionModes: [] });
  readonly supplyModel = signal<SupplyFormModel>({ ean13: '', quantity: '' });
  readonly supplyLines = signal<SupplyLineFormModel[]>([{ ean13: '', quantity: '' }]);
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

  readonly inventoryBulkModel = signal<InventoryBulkFormModel>({
    lines: [{ ...initialInventoryModel }],
  });
  readonly inventoryBulkForm = form(this.inventoryBulkModel, (schemaPath) => {
    applyEach(schemaPath.lines, (line) => {
      required(line.ean13, { message: 'L’EAN-13 est requis.' });
      pattern(line.ean13, /^\d{13}$/, { message: 'L’EAN-13 doit contenir 13 chiffres.' });
      required(line.countedQuantity, { message: 'La quantité comptée est requise.' });
      pattern(line.countedQuantity, /^\d+$/, { message: 'La quantité comptée doit être un entier supérieur ou égal à zéro.' });
    });
  });

  readonly counterMovementModel = signal<CounterMovementFormModel>({
    sourceOperationId: '',
    justification: '',
  });
  readonly counterMovementForm = form(this.counterMovementModel, (schemaPath) => {
    required(schemaPath.sourceOperationId, { message: 'Choisissez une Opération source.' });
    required(schemaPath.justification, { message: 'La justification est obligatoire.' });
    pattern(schemaPath.justification, /\S/, { message: 'La justification ne peut pas être vide.' });
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
  readonly saleArticles = signal<SaleArticleResponse[]>([]);
  readonly saleSearch = signal('');
  readonly saleSearchState = signal<SaleSearchState>('idle');
  readonly saleSearchError = signal('');
  readonly selectedSaleArticle = signal<SaleArticleResponse | null>(null);
  readonly saleContext = signal<ConsumptionMode | ''>('');
  readonly saleQuantity = signal('');
  readonly saleState = signal<SaleState>('ready');
  readonly saleFieldErrors = signal<Record<string, string>>({});
  readonly saleStatusMessage = signal('');
  readonly saleReceipt = signal<SaleResponse | null>(null);
  readonly saleSubmitting = signal(false);
  readonly supplyFieldErrors = signal<Record<string, string>>({});
  readonly supplyMessage = signal('');
  readonly supplySubmitting = signal(false);
  readonly inventoryError = signal('');
  readonly inventoryReceipt = signal<InventoryReceiptResponse | null>(null);
  readonly inventorySubmitting = signal(false);
  readonly inventoryRestoreState = signal<InventoryRestoreState>('empty');
  readonly inventoryLines = signal<InventoryFormModel[]>([{ ...initialInventoryModel }]);
  readonly inventoryLineErrors = signal<Record<string, string>>({});
  readonly counterMovementSources = signal<CounterMovementSource[]>([]);
  readonly counterMovementSourcesState = signal<CounterMovementSourcesState>('idle');
  readonly counterMovementSourceId = computed(() => this.counterMovementModel().sourceOperationId);
  readonly counterMovementJustification = computed(() => this.counterMovementModel().justification);
  readonly counterMovementFieldErrors = signal<Record<string, string>>({});
  readonly counterMovementError = signal('');
  readonly counterMovementReceipt = signal<CounterMovementResponse | null>(null);
  readonly counterMovementSubmitting = signal(false);
  readonly historyEntries = signal<HistoryEntryResponse[]>([]);
  readonly historyState = signal<HistoryState>('idle');
  readonly historyError = signal('');
  readonly historyFilterEan = signal('');
  readonly historyLoaded = signal(false);
  readonly articleHistoryEntries = signal<HistoryEntryResponse[]>([]);
  readonly articleHistoryState = signal<HistoryState>('idle');
  readonly articleHistoryError = signal('');
  readonly articleHistoryEan = signal<string | null>(null);

  private catalogRequestId = 0;
  private stockRequestId = 0;
  private stockDetailRequestId = 0;
  private detailRequestId = 0;
  private lifecycleRequestId = 0;
  private supplyRequestId = 0;
  private inventoryRestoreRequestId = 0;
  private counterMovementRequestId = 0;
  private saleRequestId = 0;
  private historyRequestId = 0;
  private articleHistoryRequestId = 0;

  ngOnInit(): void {
    void this.loadCatalog();
    void this.loadStock();
    void this.loadLastInventory();
    void this.loadLastSale();
  }

  ngAfterViewInit(): void {
    this.openCurrentRouteSection();
  }

  private openCurrentRouteSection(): void {
    const target = document.getElementById(routeSectionTargetIds[this.currentRouteSection() ?? '']);
    if (target) {
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      target.scrollIntoView();
    }
  }

  private currentRouteSection(): string | undefined {
    let route = this.router?.routerState.root;
    while (route?.firstChild) {
      route = route.firstChild;
    }
    return route?.snapshot.data['section'] as string | undefined;
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

  setSaleSearch(event: Event): void {
    this.saleSearch.set((event.target as HTMLInputElement).value);
  }

  async onSaleSearchSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await this.searchSaleArticles();
  }

  retrySaleSearch(): void {
    void this.searchSaleArticles();
  }

  async searchSaleArticles(): Promise<void> {
    const requestId = this.nextSaleRequestId();
    this.saleSearchState.set('loading');
    this.saleSearchError.set('');
    this.saleArticles.set([]);
    this.selectedSaleArticle.set(null);
    try {
      const articles = await firstValueFrom(this.salesApi.searchArticles(this.saleSearch()));
      if (requestId !== this.saleRequestId) {
        return;
      }

      this.saleArticles.set(articles);
      const selected = this.selectedSaleArticle();
      const refreshedSelection = selected
        ? articles.find((article) => article.ean13 === selected.ean13) ?? null
        : null;
      this.selectedSaleArticle.set(refreshedSelection);
      if (!refreshedSelection) {
        this.saleQuantity.set('');
      }
      this.saleSearchState.set(articles.length > 0 ? 'ready' : 'empty');
    } catch (error) {
      if (requestId !== this.saleRequestId) {
        return;
      }

      this.saleSearchState.set('error');
      this.saleSearchError.set(
        this.problemMessage(error, 'Les Articles ne peuvent pas être chargés. Réessayez.'),
      );
    }
  }

  selectSaleArticle(article: SaleArticleResponse): void {
    this.nextSaleRequestId();
    this.selectedSaleArticle.set(article);
    this.saleContext.set(
      article.type === 'food' && article.consumptionModes?.length === 1
        ? article.consumptionModes[0]
        : '',
    );
    this.saleFieldErrors.set({});
    this.saleStatusMessage.set('');
    this.saleState.set('ready');
  }

  setSaleContext(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value !== 'takeaway' && value !== 'onsite') {
      return;
    }

    this.nextSaleRequestId();
    this.saleContext.set(value);
    this.saleFieldErrors.update((errors) => {
      const next = { ...errors };
      delete next['context'];
      return next;
    });
  }

  setSaleQuantity(event: Event): void {
    this.saleQuantity.set((event.target as HTMLInputElement).value);
    this.saleFieldErrors.update((errors) => {
      const next = { ...errors };
      delete next['quantity'];
      return next;
    });
  }

  saleFieldError(field: string): string {
    return this.saleFieldErrors()[field] ?? '';
  }

  async onSaleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const requestId = this.nextSaleRequestId();
    const article = this.selectedSaleArticle();
    const rawQuantity = this.saleQuantity().trim();
    const quantity = Number(rawQuantity);
    const modes = article?.consumptionModes ?? [];
    const context = article?.type === 'food' && modes.length === 1
      ? modes[0]
      : this.saleContext();
    this.saleFieldErrors.set({});
    this.saleStatusMessage.set('');
    this.saleReceipt.set(null);

    if (!article) {
      this.saleState.set('validation');
      this.saleStatusMessage.set('Sélectionnez un Article avant de valider la Vente.');
      setTimeout(() => this.focusSaleError());
      return;
    }

    if (!/^\d+$/.test(rawQuantity)
      || !Number.isSafeInteger(quantity)
      || quantity <= 0
      || quantity > 2_147_483_647) {
      this.saleState.set('validation');
      this.saleFieldErrors.set({ quantity: 'La quantité doit être un entier strictement positif.' });
      this.saleStatusMessage.set('Corrigez la quantité avant de continuer.');
      setTimeout(() => this.focusSaleError());
      return;
    }

    if (article.type === 'food' && modes.length > 1 && !modes.includes(context as ConsumptionMode)) {
      this.saleState.set('validation');
      this.saleFieldErrors.set({ context: 'Choisissez un Contexte de Vente.' });
      this.saleStatusMessage.set('Choisissez un Contexte de Vente avant de continuer.');
      setTimeout(() => this.focusSaleError());
      return;
    }

    this.saleState.set('loading');
    this.saleStatusMessage.set('Validation de la Vente…');
    this.saleSubmitting.set(true);
    try {
      const payload: SalePayload = { ean13: article.ean13, quantity };
      if (article.type === 'food' && context) {
        payload.context = context;
      }
      const receipt = await firstValueFrom(this.salesApi.record(payload));
      if (requestId !== this.saleRequestId) {
        return;
      }

      this.saleReceipt.set(receipt);
      this.saleContext.set(receipt.financial.context ?? '');
      this.saleState.set('success');
      this.saleStatusMessage.set(`Vente ${receipt.operation.id} enregistrée.`);
      sessionStorage.setItem(lastSaleIdStorageKey, receipt.operation.id);
      this.selectedSaleArticle.update((current) => current
        ? { ...current, ...receipt.position }
        : current);
      this.replaceStockPosition(receipt.position);
      this.refreshHistoryAfterChange();
      setTimeout(() => document.getElementById('sale-result')?.focus());
    } catch (error) {
      if (requestId !== this.saleRequestId) {
        return;
      }

      const problem = this.problemDetails(error, 'La Vente n’a pas pu être enregistrée.');
      this.saleFieldErrors.set(
        Object.fromEntries(
          Object.entries(problem.errors ?? {}).map(([field, messages]) => [field, messages[0] ?? 'Valeur invalide.']),
        ),
      );
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      this.saleState.set(status === 400 ? 'validation' : status === 409 ? 'conflict' : 'error');
      this.saleStatusMessage.set(problem.title ?? 'La Vente n’a pas pu être enregistrée.');
      setTimeout(() => this.focusSaleError());
    } finally {
      if (requestId === this.saleRequestId) {
        this.saleSubmitting.set(false);
      }
    }
  }

  private async loadLastSale(): Promise<void> {
    const requestId = this.nextSaleRequestId();
    const operationId = sessionStorage.getItem(lastSaleIdStorageKey);
    if (!operationId) {
      return;
    }

    this.saleState.set('loading');
    this.saleStatusMessage.set('Rechargement de la dernière Vente…');
    try {
      const receipt = await firstValueFrom(this.salesApi.getById(operationId));
      if (requestId !== this.saleRequestId) {
        return;
      }

      let selectedArticle = this.saleArticleFromReceipt(receipt);
      try {
        const articles = await firstValueFrom(this.salesApi.searchArticles(receipt.position.ean13));
        if (requestId === this.saleRequestId) {
          selectedArticle = articles.find((article) => article.ean13 === receipt.position.ean13) ?? selectedArticle;
        }
      } catch {
        // The committed receipt remains usable when the optional quote refresh fails.
      }
      if (requestId !== this.saleRequestId) {
        return;
      }

      this.saleReceipt.set(receipt);
      this.selectedSaleArticle.set(selectedArticle);
      this.saleContext.set(receipt.financial.context ?? '');
      this.saleQuantity.set(String(receipt.operation.quantity));
      this.saleState.set('success');
      this.saleStatusMessage.set(`Vente ${receipt.operation.id} rechargée.`);
      this.replaceStockPosition(receipt.position);
    } catch (error) {
      if (requestId === this.saleRequestId) {
        this.saleState.set('error');
        this.saleStatusMessage.set(this.problemMessage(error, 'La Vente enregistrée ne peut pas être relue.'));
      }
    }
  }

  private nextSaleRequestId(): number {
    this.saleSubmitting.set(false);
    return ++this.saleRequestId;
  }

  private saleArticleFromReceipt(receipt: SaleResponse): SaleArticleResponse {
    return {
      ean13: receipt.position.ean13,
      name: receipt.position.name,
      type: receipt.position.type,
      isActive: receipt.position.isActive,
      status: receipt.position.status,
      priceHtCents: receipt.financial.unitPriceHtCents,
      physicalQuantity: receipt.position.physicalQuantity,
      sellableQuantity: receipt.position.sellableQuantity,
      availability: receipt.position.availability,
      reason: receipt.position.reason,
      dlc: receipt.position.dlc,
      consumptionModes: receipt.position.consumptionModes,
      packaging: receipt.position.packaging,
    };
  }

  setHistoryFilter(event: Event): void {
    this.historyFilterEan.set((event.target as HTMLInputElement).value);
  }

  async onHistorySubmit(event: Event): Promise<void> {
    event.preventDefault();
    await this.loadHistory();
  }

  retryHistory(): void {
    void this.loadHistory();
  }

  async loadHistory(ean13?: string): Promise<void> {
    const requestId = ++this.historyRequestId;
    const filter = (ean13 ?? this.historyFilterEan()).trim();
    if (ean13 !== undefined) {
      this.historyFilterEan.set(ean13);
    }
    this.historyLoaded.set(true);
    this.historyState.set('loading');
    this.historyError.set('');
    this.historyEntries.set([]);
    try {
      const entries = await firstValueFrom(this.historyApi.list(filter || undefined));
      if (requestId !== this.historyRequestId) {
        return;
      }
      this.historyEntries.set(entries);
      this.historyState.set(entries.length > 0 ? 'ready' : 'empty');
    } catch (error) {
      if (requestId !== this.historyRequestId) {
        return;
      }
      this.historyState.set('error');
      this.historyError.set(this.problemMessage(error, 'L’Historique ne peut pas être chargé. Réessayez.'));
    }
  }

  async loadArticleHistory(ean13: string): Promise<void> {
    const requestId = ++this.articleHistoryRequestId;
    this.articleHistoryEan.set(ean13);
    this.articleHistoryState.set('loading');
    this.articleHistoryError.set('');
    this.articleHistoryEntries.set([]);
    try {
      const entries = await firstValueFrom(this.historyApi.list(ean13));
      if (requestId !== this.articleHistoryRequestId) {
        return;
      }
      this.articleHistoryEntries.set(entries);
      this.articleHistoryState.set(entries.length > 0 ? 'ready' : 'empty');
      setTimeout(() => document.getElementById('article-history-panel')?.focus());
    } catch (error) {
      if (requestId !== this.articleHistoryRequestId) {
        return;
      }
      this.articleHistoryState.set('error');
      this.articleHistoryError.set(this.problemMessage(error, 'L’Historique de l’Article ne peut pas être chargé.'));
    }
  }

  formatHistoryType(type: HistoryEntryType): string {
    return type === 'SUPPLY'
      ? 'Approvisionnement'
      : type === 'INVENTORY'
        ? 'Inventaire'
        : type === 'SALE_STOCK'
          ? 'Vente Stock'
          : type === 'COUNTER_MOVEMENT'
            ? 'Contre-mouvement'
            : type === 'CATALOG_ARCHIVE'
              ? 'Archivage Catalogue'
              : type === 'CATALOG_REACTIVATE'
                ? 'Réactivation Catalogue'
                : type === 'CATALOG_DLC_CHANGE'
                  ? 'Changement de DLC'
                  : type === 'CATALOG_PACKAGING_CHANGE'
                    ? 'Changement de Packaging'
                    : 'Changement Catalogue';
  }

  formatHistoryEffect(effect: number | null | undefined): string {
    if (effect === undefined || effect === null) {
      return '—';
    }
    return effect > 0 ? `+${effect}` : String(effect);
  }

  formatHistoryArticles(entry: HistoryEntryResponse): string {
    return entry.articles.map((article) => article.ean13).join(', ');
  }

  private refreshHistoryAfterChange(): void {
    if (this.historyLoaded()) {
      void this.loadHistory();
    }
    const ean13 = this.articleHistoryEan();
    if (ean13) {
      void this.loadArticleHistory(ean13);
    }
  }

  async onInventorySubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.inventoryError.set('');
    this.inventoryReceipt.set(null);
    this.inventoryLineErrors.set({});
    this.inventoryRestoreRequestId += 1;
    this.inventoryRestoreState.set('empty');
    this.syncLegacyInventoryModel();
    let succeeded = false;
    await submit(this.inventoryBulkForm, {
      action: async () => {
        succeeded = await this.registerInventory();
        return undefined;
      },
      onInvalid: () => {
        this.inventoryError.set('Corrigez les erreurs signalées avant de continuer.');
      },
    });
    if (!succeeded) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      this.restoreInventoryFocus();
    }
  }

  async loadCounterMovementSources(): Promise<void> {
    const requestId = ++this.counterMovementRequestId;
    this.counterMovementSourcesState.set('loading');
    this.counterMovementError.set('');
    try {
      const sources = await firstValueFrom(this.counterMovementApi.listSources());
      if (requestId !== this.counterMovementRequestId) {
        return;
      }

      this.counterMovementSources.set(sources);
      if (!sources.some((source) => source.id === this.counterMovementSourceId())) {
        this.counterMovementModel.update((model) => ({ ...model, sourceOperationId: '' }));
      }
      this.counterMovementSourcesState.set(sources.length > 0 ? 'ready' : 'empty');
    } catch (error) {
      if (requestId !== this.counterMovementRequestId) {
        return;
      }

      this.counterMovementSources.set([]);
      this.counterMovementSourcesState.set('error');
      this.counterMovementError.set(
        this.problemMessage(error, 'Les Opérations corrigeables ne peuvent pas être chargées.'),
      );
    }
  }

  clearCounterMovementField(field: 'sourceOperationId' | 'justification'): void {
    this.counterMovementFieldErrors.update((errors) => ({ ...errors, [field]: '' }));
  }

  selectedCounterMovementSource(): CounterMovementSource | undefined {
    return this.counterMovementSources().find((source) => source.id === this.counterMovementSourceId());
  }

  counterMovementFieldError(field: 'sourceOperationId' | 'justification'): string {
    const serverError = this.counterMovementFieldErrors()[field];
    if (serverError) {
      return serverError;
    }

    return field === 'sourceOperationId'
      ? this.counterMovementForm.sourceOperationId().errors()[0]?.message ?? ''
      : this.counterMovementForm.justification().errors()[0]?.message ?? '';
  }

  counterMovementErrorId(field: 'sourceOperationId' | 'justification'): string {
    return field === 'sourceOperationId'
      ? 'counter-movement-sourceOperationId-error'
      : 'counter-movement-justification-error';
  }

  async onCounterMovementSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const requestId = ++this.counterMovementRequestId;
    this.counterMovementFieldErrors.set({});
    this.counterMovementError.set('');
    this.counterMovementReceipt.set(null);

    let shouldRestoreFocus = false;
    await submit(this.counterMovementForm, {
      action: async () => {
        shouldRestoreFocus = !(await this.registerCounterMovement(requestId));
        return undefined;
      },
      onInvalid: () => {
        shouldRestoreFocus = true;
        this.counterMovementError.set('Corrigez les erreurs signalées avant de continuer.');
      },
    });
    if (shouldRestoreFocus) {
      setTimeout(() => this.focusCounterMovementError());
    }
  }

  private async registerCounterMovement(requestId: number): Promise<boolean> {
    this.counterMovementSubmitting.set(true);
    try {
      const receipt = await firstValueFrom(this.counterMovementApi.correct({
        sourceOperationId: this.counterMovementSourceId(),
        justification: this.counterMovementJustification(),
      }));
      if (requestId !== this.counterMovementRequestId) {
        return true;
      }

      this.counterMovementReceipt.set(receipt);
      this.counterMovementSources.update((sources) => sources.filter((source) => source.id !== receipt.counterMovement.sourceOperationId));
      this.counterMovementModel.update((model) => ({ ...model, sourceOperationId: '' }));
      this.counterMovementSourcesState.set(this.counterMovementSources().length > 0 ? 'ready' : 'empty');
      await this.loadStock();
      this.refreshHistoryAfterChange();
      setTimeout(() => document.getElementById('counter-movement-result')?.focus());
      return true;
    } catch (error) {
      if (requestId !== this.counterMovementRequestId) {
        return true;
      }

      const problem = this.problemDetails(error, 'Le Contre-mouvement n’a pas pu être enregistré.');
      this.counterMovementFieldErrors.set(
        Object.fromEntries(
          Object.entries(problem.errors ?? {}).map(([field, messages]) => [field, messages[0] ?? 'Valeur invalide.']),
        ),
      );
      this.counterMovementError.set(
        problem.title ?? 'Le Contre-mouvement n’a pas pu être enregistré.',
      );
      return false;
    } finally {
      if (requestId === this.counterMovementRequestId) {
        this.counterMovementSubmitting.set(false);
      }
    }
  }

  formatCounterMovementSourceType(type: CounterMovementSourceType): string {
    return type === 'SUPPLY' ? 'Approvisionnement' : type === 'INVENTORY' ? 'Inventaire' : 'Vente';
  }

  formatCounterMovementAvailability(availability: CounterMovementAvailability): string {
    return availability === 'AVAILABLE'
      ? 'Disponible'
      : availability === 'OUT_OF_STOCK'
        ? 'Rupture'
        : 'Non vendable';
  }

  formatCounterMovementReason(reason: CounterMovementReason | null): string {
    return this.formatStockReason(reason);
  }

  formatCounterMovementFinancialContext(context: CounterMovementFinancialResponse['context']): string {
    return context === 'takeaway' ? 'À emporter' : context === 'onsite' ? 'Sur place' : 'Non alimentaire';
  }

  formatCounterMovementEffect(effect: number): string {
    return effect > 0 ? `+${effect}` : String(effect);
  }

  counterMovementPosition(
    receipt: CounterMovementResponse,
    ean13: string,
  ): CounterMovementResponse['positions'][number] | undefined {
    return receipt.positions.find((position) => position.ean13 === ean13);
  }

  setInventoryEan(index: number, event: Event): void {
    this.updateInventoryLine(index, 'ean13', (event.target as HTMLInputElement).value);
  }

  setInventoryCountedQuantity(index: number, event: Event): void {
    this.updateInventoryLine(index, 'countedQuantity', (event.target as HTMLInputElement).value);
  }

  addInventoryLine(): void {
    const lines = [...this.inventoryLines(), { ...initialInventoryModel }];
    this.inventoryLines.set(lines);
    this.inventoryBulkModel.update((model) => ({
      lines: [...model.lines, { ...initialInventoryModel }],
    }));
  }

  removeInventoryLine(index: number): void {
    if (this.inventoryLines().length === 1) {
      return;
    }

    const lines = this.inventoryLines().filter((_, lineIndex) => lineIndex !== index);
    this.inventoryLines.set(lines);
    this.inventoryBulkModel.update((model) => ({
      lines: model.lines.filter((_, lineIndex) => lineIndex !== index),
    }));
    this.inventoryLineErrors.update((errors) =>
      Object.fromEntries(
        Object.entries(errors)
          .filter(([key]) => Number(key.split('.')[0]) !== index)
          .map(([key, value]) => {
            const [lineIndex, field] = key.split('.');
            const shiftedIndex = Number(lineIndex) > index ? Number(lineIndex) - 1 : Number(lineIndex);
            return [`${shiftedIndex}.${field}`, value];
          }),
      ),
    );
    this.inventoryModel.set(this.inventoryLines()[0] ?? { ...initialInventoryModel });
  }

  inventoryFieldId(field: 'ean13' | 'countedQuantity', index: number): string {
    return `inventory-${field}${index === 0 ? '' : `-${index}`}`;
  }

  inventoryErrorId(field: 'ean13' | 'countedQuantity', index: number): string {
    return `${this.inventoryFieldId(field, index)}-error`;
  }

  inventoryLineError(index: number, field: 'ean13' | 'countedQuantity'): string {
    const serverError = this.inventoryLineErrors()[`${index}.${field}`];
    if (serverError) {
      return serverError;
    }

    const fieldTree = this.inventoryFieldAt(index, field);
    return fieldTree?.().errors()[0]?.message ?? '';
  }

  inventoryErrorDescription(index: number, field: 'ean13' | 'countedQuantity'): string | null {
    return this.inventoryLineError(index, field) ? this.inventoryErrorId(field, index) : null;
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
    return field === 'ean13' || field === 'quantity'
      ? this.supplyLineFieldError(0, field)
      : this.supplyFieldErrors()[field] ?? '';
  }

  supplyLineFieldError(index: number, field: 'ean13' | 'quantity'): string {
    const errors = this.supplyFieldErrors();
    return errors[`lines[${index}].${field}`]
      ?? errors[`lines[${index}]`]
      ?? (index === 0 ? errors[field] : '')
      ?? '';
  }

  supplyInputId(field: 'ean13' | 'quantity', index: number): string {
    const base = field === 'ean13' ? 'supplyEan13' : 'supplyQuantity';
    return index === 0 ? base : `${base}-${index}`;
  }

  supplyErrorId(field: 'ean13' | 'quantity', index: number): string {
    const base = field === 'ean13' ? 'supply-ean13-error' : 'supply-quantity-error';
    return index === 0 ? base : `supply-${field}-${index}-error`;
  }

  supplyLineTitleId(index: number): string {
    return `supply-line-${index}-title`;
  }

  setSupplyLineField(index: number, field: 'ean13' | 'quantity', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.supplyLines.update((lines) => lines.map((line, lineIndex) =>
      lineIndex === index ? { ...line, [field]: value } : line));
    if (index === 0) {
      this.supplyModel.update((line) => ({ ...line, [field]: value }));
    }
  }

  addSupplyLine(): void {
    this.supplyLines.update((lines) => [...lines, { ean13: '', quantity: '' }]);
  }

  removeSupplyLine(index: number): void {
    const lines = this.supplyLines();
    if (lines.length <= 1 || !lines[index]) {
      return;
    }

    const remaining = lines.filter((_, lineIndex) => lineIndex !== index);
    this.supplyLines.set(remaining);
    this.supplyModel.set({ ...remaining[0] });
    this.supplyFieldErrors.update((errors) => Object.entries(errors).reduce<Record<string, string>>(
      (rebased, [field, message]) => {
        const match = field.match(/^lines\[(\d+)\](.*)$/);
        if (!match) {
          rebased[field] = message;
          return rebased;
        }

        const lineIndex = Number(match[1]);
        if (lineIndex === index) {
          return rebased;
        }

        const nextIndex = lineIndex > index ? lineIndex - 1 : lineIndex;
        rebased[`lines[${nextIndex}]${match[2]}`] = message;
        return rebased;
      },
      {},
    ));
  }

  async onSupplySubmit(event: Event): Promise<void> {
    event.preventDefault();
    const requestId = ++this.supplyRequestId;
    this.supplyFieldErrors.set({});
    this.supplyMessage.set('');
    this.supplySubmitting.set(true);

    const draftLines = this.supplyLinesForSubmit();
    const payloadLines: SupplyPayload[] = draftLines.map((line) => ({
      ean13: line.ean13.trim(),
      quantity: this.toSupplyQuantity(line.quantity),
    }));

    try {
      let operation: { id: string; occurredAt: string };
      let positions: StockPositionResponse[];
      if (payloadLines.length === 1) {
        const response = await firstValueFrom(this.stockApi.recordSupply(payloadLines[0]));
        operation = response.operation;
        positions = [response.position];
      } else {
        const payload: BulkSupplyPayload = { lines: payloadLines };
        const response = await firstValueFrom(this.stockApi.recordBulkSupply(payload));
        operation = response.operation;
        positions = response.positions;
      }
      if (requestId !== this.supplyRequestId) {
        return;
      }

      this.replaceStockPositions(positions);
      this.supplyMessage.set(
        `Approvisionnement ${operation.id} enregistré le ${operation.occurredAt}.`,
      );
      this.refreshHistoryAfterChange();
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

  receiptLines(receipt: InventoryReceiptResponse): InventoryDisplayLine[] {
    if (this.isBulkReceipt(receipt)) {
      return receipt.operation.lines.map((line) => ({
        lineNumber: line.lineNumber,
        ean13: line.ean13,
        previousPhysicalStock: line.previousPhysicalStock,
        countedQuantity: line.countedQuantity,
        inventoryDifference: line.inventoryDifference,
        resultingPhysicalStock: line.resultingPhysicalStock,
        position: line.position,
      }));
    }

    return [{
      lineNumber: 1,
      ean13: receipt.operation.ean13,
      previousPhysicalStock: receipt.operation.previousPhysicalStock,
      countedQuantity: receipt.operation.countedQuantity,
      inventoryDifference: receipt.operation.inventoryDifference,
      resultingPhysicalStock: receipt.operation.resultingPhysicalStock,
      position: receipt.position,
    }];
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
      this.refreshHistoryAfterChange();
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
      this.refreshHistoryAfterChange();
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

  private async registerInventory(): Promise<boolean> {
    this.inventorySubmitting.set(true);
    this.inventoryReceipt.set(null);
    try {
      const lines = this.inventoryLines().map((line) => ({
        ean13: line.ean13,
        countedQuantity: Number(line.countedQuantity),
      }));
      const receipt = lines.length === 1
        ? await firstValueFrom(this.inventoryApi.register(lines[0]))
        : await firstValueFrom(this.inventoryApi.registerBulk({ lines }));
      this.inventoryReceipt.set(receipt);
      this.inventoryRestoreState.set('ready');
      sessionStorage.setItem(lastInventoryIdStorageKey, receipt.operation.id);
      setTimeout(() => document.getElementById('inventory-result')?.focus());
      void this.loadStock();
      this.refreshHistoryAfterChange();
      return true;
    } catch (error) {
      const problem = this.problemDetails(error, 'L’Inventaire n’a pas pu être enregistré.');
      this.inventoryError.set(problem.title ?? 'L’Inventaire n’a pas pu être enregistré.');
      this.setInventoryServerErrors(problem.errors ?? {});
      return false;
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
      const operationLines = operation.lines ?? [{
        lineNumber: 1,
        ean13: operation.ean13,
        previousPhysicalStock: operation.previousPhysicalStock,
        countedQuantity: operation.countedQuantity,
        inventoryDifference: operation.inventoryDifference,
        resultingPhysicalStock: operation.resultingPhysicalStock,
      }];
      const lines = await Promise.all(operationLines.map(async (line) => {
        const position = await firstValueFrom(this.stockApi.getByEan13(line.ean13));
        return {
          ...line,
          position: {
            ean13: position.ean13,
            physicalStock: position.physicalQuantity,
            sellableStock: position.sellableQuantity,
            availability: position.availability,
            reason: position.reason,
          },
        };
      }));
      if (requestId !== this.inventoryRestoreRequestId) {
        return;
      }

      if (operation.lines) {
        this.inventoryReceipt.set({
          operation: {
            id: operation.id,
            type: 'INVENTORY',
            timestampUtc: operation.timestampUtc,
            lines: lines as BulkInventoryResponse['operation']['lines'],
          },
        });
      } else {
        this.inventoryReceipt.set({
          operation,
          position: lines[0].position!,
        });
      }
      this.inventoryRestoreState.set('ready');
    } catch {
      if (requestId === this.inventoryRestoreRequestId) {
        this.inventoryRestoreState.set('error');
      }
    }
  }

  private updateInventoryLine(
    index: number,
    field: keyof InventoryFormModel,
    value: string): void {
    const lines = this.inventoryLines().map((line, lineIndex) =>
      lineIndex === index ? { ...line, [field]: value } : line);
    this.inventoryLines.set(lines);
    if (index === 0) {
      this.inventoryModel.update((line) => ({ ...line, [field]: value }));
    }
    this.inventoryLineErrors.update((errors) => {
      const next = { ...errors };
      delete next[`${index}.${field}`];
      return next;
    });
  }

  private isBulkReceipt(receipt: InventoryReceiptResponse): receipt is BulkInventoryResponse {
    const lines = (receipt.operation as BulkInventoryResponse['operation']).lines;
    return Array.isArray(lines) && lines.every((line) => line.position !== undefined);
  }

  private syncLegacyInventoryModel(): void {
    const legacyModel = this.inventoryModel();
    let lines = this.inventoryLines();
    if (lines.length === 1
      && lines[0].ean13 === ''
      && lines[0].countedQuantity === ''
      && (legacyModel.ean13 !== '' || legacyModel.countedQuantity !== '')) {
      lines = [{ ...legacyModel }];
      this.inventoryLines.set(lines);
    }
    const currentLines = this.inventoryBulkModel().lines;
    const sameValues = currentLines.length === lines.length
      && currentLines.every((line, index) =>
        line.ean13 === lines[index].ean13
        && line.countedQuantity === lines[index].countedQuantity);
    if (!sameValues) {
      this.inventoryBulkModel.set({ lines });
    }
  }

  private setInventoryServerErrors(errors: Record<string, string[]>): void {
    this.inventoryLineErrors.set(
      Object.fromEntries(
        Object.entries(errors).flatMap(([field, messages]) => {
          const match = /^lines\[(\d+)\]\.(ean13|countedQuantity)$/.exec(field);
          if (match) {
            return [[`${match[1]}.${match[2]}`, messages[0] ?? 'Valeur invalide.']];
          }

          if (field === 'ean13' || field === 'countedQuantity') {
            return [[`0.${field}`, messages[0] ?? 'Valeur invalide.']];
          }

          return [];
        }),
      ),
    );
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

  private replaceStockPositions(positions: readonly StockPositionResponse[]): void {
    positions.forEach((position) => this.replaceStockPosition(position));
  }

  private supplyLinesForSubmit(): SupplyLineFormModel[] {
    const lines = this.supplyLines().map((line) => ({ ...line }));
    const legacyLine = this.supplyModel();
    if (!lines[0]
      || lines[0].ean13 !== legacyLine.ean13
      || lines[0].quantity !== legacyLine.quantity) {
      lines[0] = { ...legacyLine };
    }
    return lines;
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

  private inventoryFieldAt(index: number, field: 'ean13' | 'countedQuantity'): FieldTree<string> | undefined {
    const line = this.inventoryBulkForm.lines[index];
    return line?.[field] as FieldTree<string> | undefined;
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
    const firstInvalidField = Object.keys(this.inventoryLineErrors())
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))[0];
    if (firstInvalidField) {
      const [index, field] = firstInvalidField.split('.');
      document.getElementById(
        this.inventoryFieldId(field as 'ean13' | 'countedQuantity', Number(index)),
      )?.focus();
      return;
    }

    document.getElementById(this.inventoryFieldId('countedQuantity', 0))?.focus();
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
    if (this.articleHistoryEan() !== null && this.articleHistoryEan() !== article.ean13) {
      this.articleHistoryRequestId += 1;
      this.articleHistoryEan.set(null);
      this.articleHistoryEntries.set([]);
      this.articleHistoryState.set('idle');
      this.articleHistoryError.set('');
    }
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
    const field = Object.keys(this.supplyFieldErrors())[0] ?? '';
    const lineField = field.match(/^lines\[(\d+)\]\.(ean13|quantity)$/);
    const lineError = field.match(/^lines\[(\d+)\]$/);
    const line = lineField ? Number(lineField[1]) : lineError ? Number(lineError[1]) : 0;
    const fieldName = lineField?.[2] ?? (lineError ? 'ean13' : field);
    const target = fieldName === 'ean13'
      ? document.getElementById(this.supplyInputId('ean13', line))
      : fieldName === 'quantity'
        ? document.getElementById(this.supplyInputId('quantity', line))
        : document.getElementById('supply-status');
    target?.focus();
  }

  private focusSaleError(): void {
    const field = Object.keys(this.saleFieldErrors())[0];
    const target = field === 'quantity'
      ? document.getElementById('sale-quantity')
      : field === 'context'
        ? document.querySelector<HTMLElement>('#sale-context input')
        : document.getElementById('sale-status');
    target?.focus();
  }

  private focusCounterMovementError(): void {
    const field = Object.keys(this.counterMovementFieldErrors())[0]
      ?? (this.counterMovementForm.sourceOperationId().errors().length > 0
        ? 'sourceOperationId'
        : this.counterMovementForm.justification().errors().length > 0
          ? 'justification'
          : '');
    const target = field === 'sourceOperationId'
      ? document.getElementById('counter-movement-source')
      : field === 'justification'
        ? document.getElementById('counter-movement-justification')
        : document.getElementById('counter-movement-error');
    target?.focus();
  }
}
