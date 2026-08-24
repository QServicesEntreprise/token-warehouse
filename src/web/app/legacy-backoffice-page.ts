import { HttpErrorResponse } from '@angular/common/http';
import { AfterViewInit, ApplicationRef, ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  FormField,
  FormRoot,
  form,
  pattern,
  required,
  submit,
} from '@angular/forms/signals';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { ConsumptionMode } from '../shared-kernel/consumption-mode';
import { DashboardComponent } from './dashboard.component';
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
  HistoryApiService,
  HistoryEntryResponse,
  HistoryEntryType,
} from './history-api.service';

interface ProblemDetails {
  code?: string;
  errors?: Record<string, string[]>;
  title?: string;
}

interface CounterMovementFormModel {
  sourceOperationId: string;
  justification: string;
}

type CounterMovementSourcesState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
type HistoryState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

const routeSectionTargetIds: Record<string, string> = {
  dashboard: 'dashboard-title',
  corrections: 'counter-movement-title',
  historique: 'history-title',
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

    </main>
  `,
})
export class LegacyBackofficePage implements AfterViewInit {
  private readonly router = inject(Router, { optional: true });
  private readonly applicationRef = inject(ApplicationRef);

  private readonly counterMovementApi = inject(CounterMovementApiService);
  private readonly historyApi = inject(HistoryApiService);

  constructor() {
    this.router?.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.openCurrentRouteSection();
      }
    });
  }

  readonly counterMovementModel = signal<CounterMovementFormModel>({
    sourceOperationId: '',
    justification: '',
  });
  readonly counterMovementForm = form(this.counterMovementModel, (schemaPath) => {
    required(schemaPath.sourceOperationId, { message: 'Choisissez une Opération source.' });
    required(schemaPath.justification, { message: 'La justification est obligatoire.' });
    pattern(schemaPath.justification, /\S/, { message: 'La justification ne peut pas être vide.' });
  });

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
  private counterMovementRequestId = 0;
  private historyRequestId = 0;
  private openedRouteSection = '';

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

  formatStockAvailability(availability: CounterMovementAvailability): string {
    return availability === 'AVAILABLE'
      ? 'Disponible'
      : availability === 'OUT_OF_STOCK'
        ? 'Rupture'
        : 'Non vendable';
  }

  formatStockReason(reason: CounterMovementReason | null): string {
    return reason === 'ARCHIVED'
      ? 'Article archivé'
      : reason === 'DLC_EXPIRED'
        ? 'DLC dépassée'
        : reason === 'UNSELLABLE_PACKAGING'
          ? 'Packaging invendable'
          : '—';
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
