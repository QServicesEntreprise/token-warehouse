import { HttpErrorResponse } from '@angular/common/http';
import { AfterViewInit, ApplicationRef, ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import {
  FieldTree,
  FormField,
  FormRoot,
  applyEach,
  form,
  pattern,
  required,
  submit,
} from '@angular/forms/signals';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { ConsumptionMode } from '../shared-kernel/consumption-mode';
import {
  InventoryApiService,
  BulkInventoryResponse,
  InventoryResponse,
  InventoryOperationLineResponse,
} from './inventory-api.service';
import {
  HistoryApiService,
  HistoryEntryResponse,
  HistoryEntryType,
} from './history-api.service';

interface ProblemDetails {
  code?: string;
  errors?: Record<string, string[]>;
  title?: string;
}

interface InventoryFormModel {
  ean13: string;
  countedQuantity: string;
}

interface InventoryBulkFormModel {
  lines: InventoryFormModel[];
}

type InventoryReceiptResponse = InventoryResponse | BulkInventoryResponse;
type StockAvailability = NonNullable<InventoryOperationLineResponse['position']>['availability'];
type StockReason = NonNullable<InventoryOperationLineResponse['position']>['reason'];

interface InventoryDisplayLine {
  lineNumber: number;
  ean13: string;
  previousPhysicalStock: number;
  countedQuantity: number;
  inventoryDifference: number;
  resultingPhysicalStock: number;
  position: NonNullable<InventoryOperationLineResponse['position']>;
}

type InventoryRestoreState = 'loading' | 'ready' | 'empty' | 'error';
type HistoryState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

const initialInventoryModel: InventoryFormModel = {
  ean13: '',
  countedQuantity: '',
};

const lastInventoryIdStorageKey = 'token-warehouse.last-inventory-id';
const routeSectionTargetIds: Record<string, string> = {
  inventaires: 'inventory-title',
  historique: 'history-title',
};

@Component({
  selector: 'app-legacy-backoffice-page',
  standalone: true,
  imports: [FormField, FormRoot],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main aria-labelledby="page-title">
      <header class="page-header">
        <p class="eyebrow">Catalogue d’Articles</p>
        <h1 id="page-title">Créer et consulter un Article</h1>
        <p>Une référence EAN-13, un Prix HT en centimes et les attributs de sa classification.</p>
      </header>


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
                    <div><dt>Contexte historique</dt><dd>{{ formatFinancialContext(reversal.context) }}</dd></div>
                    <div><dt>Taux de TVA historique</dt><dd>{{ reversal.taxRate.ratio }}</dd></div>
                    <div><dt>Inversion financière HT</dt><dd>{{ formatSignedEffect(reversal.amountHtCents) }} centimes</dd></div>
                    <div><dt>Inversion financière TVA</dt><dd>{{ formatSignedEffect(reversal.vatCents) }} centimes</dd></div>
                    <div><dt>Inversion financière TTC</dt><dd>{{ formatSignedEffect(reversal.amountTtcCents) }} centimes</dd></div>
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

    </main>
  `,
})
export class LegacyBackofficePage implements AfterViewInit, OnInit {
  private readonly router = inject(Router, { optional: true });
  private readonly applicationRef = inject(ApplicationRef);

  private readonly inventoryApi = inject(InventoryApiService);
  private readonly historyApi = inject(HistoryApiService);

  constructor() {
    this.router?.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.openCurrentRouteSection();
      }
    });
  }

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

  readonly inventoryError = signal('');
  readonly inventoryReceipt = signal<InventoryReceiptResponse | null>(null);
  readonly inventorySubmitting = signal(false);
  readonly inventoryRestoreState = signal<InventoryRestoreState>('empty');
  readonly inventoryLines = signal<InventoryFormModel[]>([{ ...initialInventoryModel }]);
  readonly inventoryLineErrors = signal<Record<string, string>>({});
  readonly historyEntries = signal<HistoryEntryResponse[]>([]);
  readonly historyState = signal<HistoryState>('idle');
  readonly historyError = signal('');
  readonly historyFilterEan = signal('');
  readonly historyLoaded = signal(false);
  private inventoryRestoreRequestId = 0;
  private historyRequestId = 0;
  private openedRouteSection = '';

  ngOnInit(): void {
    void this.loadLastInventory();
  }

  ngAfterViewInit(): void {
    this.openCurrentRouteSection();
  }

  private openCurrentRouteSection(): void {
    const section = this.currentRouteSection() ?? '';
    this.openedRouteSection = section;
    if (section === 'historique' && this.historyLoaded()) {
      void this.loadHistory();
    }
    void this.applicationRef.whenStable().then(() => {
      if (this.openedRouteSection !== section) return;
      const target = document.getElementById(routeSectionTargetIds[section]);
      if (!target) return;
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      target.scrollIntoView();
    });
  }

  private currentRouteSection(): string | undefined {
    let route = this.router?.routerState.root;
    while (route?.firstChild) {
      route = route.firstChild;
    }
    return route?.snapshot.data['section'] as string | undefined;
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

  formatFinancialContext(context: 'takeaway' | 'onsite' | null): string {
    return context === 'takeaway' ? 'À emporter' : context === 'onsite' ? 'Sur place' : 'Non alimentaire';
  }

  formatSignedEffect(effect: number): string {
    return effect > 0 ? `+${effect}` : String(effect);
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
        const position = await firstValueFrom(this.inventoryApi.getStockByEan13(line.ean13));
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

  private problemDetails(error: unknown, fallback = 'La requête a échoué.'): ProblemDetails {
    if (error instanceof HttpErrorResponse && typeof error.error === 'object' && error.error !== null) {
      return error.error as ProblemDetails;
    }
    return { title: fallback };
  }

  private problemMessage(error: unknown, fallback: string): string {
    const problem = this.problemDetails(error, fallback);
    return problem.title ?? fallback;
  }

}
