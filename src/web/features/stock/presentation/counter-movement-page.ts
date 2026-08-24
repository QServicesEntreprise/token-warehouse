import { AfterViewInit, ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, pattern, required, submit } from '@angular/forms/signals';
import { CounterMovementStore } from '../application/counter-movement-store';
import { stockAvailabilityLabel } from './stock-availability-label';
import { stockNonSellableReasonLabel } from './stock-non-sellable-reason-label';

@Component({
  selector: 'app-counter-movement-page',
  standalone: true,
  imports: [FormField, FormRoot],
  templateUrl: './counter-movement-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CounterMovementPage implements AfterViewInit {
  readonly store = inject(CounterMovementStore);
  private readonly model = signal({ sourceOperationId: '', justification: '' });
  private readonly clientMessageValue = signal('');

  readonly correctionForm = form(this.model, (path) => {
    required(path.sourceOperationId, { message: 'Choisissez une Opération source.' });
    required(path.justification, { message: 'La justification est obligatoire.' });
    pattern(path.justification, /\S/, { message: 'La justification ne peut pas être vide.' });
  });
  readonly selectedSource = computed(() => this.store.sources().find(
    ({ id }) => id === this.model().sourceOperationId,
  ));
  readonly clientMessage = this.clientMessageValue.asReadonly();
  readonly availabilityLabel = stockAvailabilityLabel;
  readonly reasonLabel = stockNonSellableReasonLabel;

  ngAfterViewInit(): void {
    document.getElementById('counter-movement-title')?.focus();
  }

  loadSources(): void {
    this.clientMessageValue.set('');
    this.store.loadSources();
  }

  clearField(field: 'sourceOperationId' | 'justification'): void {
    this.store.clearFieldError(field);
    this.clientMessageValue.set('');
  }

  fieldError(field: 'sourceOperationId' | 'justification'): string {
    return this.store.fieldErrors()[field]
      || this.correctionForm[field]().errors()[0]?.message
      || '';
  }

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.clientMessageValue.set('');
    let succeeded = false;
    await submit(this.correctionForm, {
      action: async () => {
        succeeded = await this.store.record(this.model());
        return undefined;
      },
      onInvalid: () => this.clientMessageValue.set('Corrigez les erreurs signalées avant de continuer.'),
    });

    if (succeeded) {
      this.model.update((model) => ({ ...model, sourceOperationId: '' }));
      setTimeout(() => document.getElementById('counter-movement-result')?.focus());
    } else {
      setTimeout(() => this.focusError());
    }
  }

  sourceTypeLabel(type: 'SUPPLY' | 'INVENTORY' | 'SALE'): string {
    return type === 'SUPPLY' ? 'Approvisionnement' : type === 'INVENTORY' ? 'Inventaire' : 'Vente';
  }

  financialContextLabel(context: 'takeaway' | 'onsite' | null): string {
    return context === 'takeaway' ? 'À emporter' : context === 'onsite' ? 'Sur place' : 'Non alimentaire';
  }

  signed(effect: number): string {
    return effect > 0 ? `+${effect}` : String(effect);
  }

  private focusError(): void {
    const target = this.fieldError('sourceOperationId')
      ? document.getElementById('counter-movement-source')
      : this.fieldError('justification')
        ? document.getElementById('counter-movement-justification')
        : document.getElementById('counter-movement-error');
    target?.focus();
  }
}
