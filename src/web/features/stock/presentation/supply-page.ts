import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormField, FormRoot, applyEach, form, required, submit } from '@angular/forms/signals';
import { SupplyStore } from '../application/supply-store';
import { RecordSupplyCommand } from '../domain/record-supply-command';
import { StockPosition } from '../domain/stock-position';

interface SupplyLineFormModel {
  ean13: string;
  quantity: string;
}

interface SupplyFormModel {
  lines: SupplyLineFormModel[];
}

@Component({
  selector: 'app-supply-page',
  standalone: true,
  imports: [FormField, FormRoot],
  templateUrl: './supply-page.html',
  styleUrl: './supply-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupplyPage implements AfterViewInit {
  readonly store = inject(SupplyStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly modelState = signal<SupplyFormModel>({ lines: [{ ean13: '', quantity: '' }] });
  private readonly clientMessageState = signal('');
  private readonly serverFieldErrorsState = signal<Record<string, string>>({});
  private destroyed = false;
  readonly model = this.modelState.asReadonly();
  readonly statusMessage = computed(() => this.clientMessageState() || this.store.statusMessage());
  readonly supplyForm = form(this.modelState, (path) => {
    applyEach(path.lines, (line) => {
      required(line.ean13, { message: 'L’EAN-13 est requis.' });
      required(line.quantity, { message: 'La quantité est requise.' });
    });
  });

  constructor() {
    this.destroyRef.onDestroy(() => { this.destroyed = true; });
  }

  ngAfterViewInit(): void {
    document.getElementById('supply-title')?.focus();
  }

  addLine(): void {
    this.modelState.update((model) => ({
      lines: [...model.lines, { ean13: '', quantity: '' }],
    }));
  }

  removeLine(index: number): void {
    if (this.model().lines.length <= 1) return;
    this.serverFieldErrorsState.update((errors) => Object.fromEntries(
      Object.entries(errors).flatMap(([field, message]) => {
        const match = field.match(/^lines\[(\d+)\](.*)$/);
        if (!match) return [[field, message]];
        const lineIndex = Number(match[1]);
        if (lineIndex === index) return [];
        return [[`lines[${lineIndex > index ? lineIndex - 1 : lineIndex}]${match[2]}`, message]];
      }),
    ));
    this.modelState.update((model) => ({
      lines: model.lines.filter((_, lineIndex) => lineIndex !== index),
    }));
  }

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.clientMessageState.set('');
    this.serverFieldErrorsState.set({});
    let succeeded = false;
    await submit(this.supplyForm, {
      action: async () => {
        const lines = this.model().lines.map((line): RecordSupplyCommand => ({
          ean13: line.ean13.trim(),
          quantity: this.quantity(line.quantity),
        }));
        succeeded = lines.length === 1
          ? await this.store.recordSupply(lines[0])
          : await this.store.recordBulkSupply({ lines });
        this.serverFieldErrorsState.set(this.store.fieldErrors());
        return undefined;
      },
      onInvalid: () => this.clientMessageState.set('Corrigez l’Approvisionnement avant de continuer.'),
    });
    if (this.destroyed) return;
    setTimeout(() => {
      if (this.destroyed) return;
      (succeeded ? document.getElementById('supply-status') : this.errorTarget())?.focus();
    });
  }

  fieldError(index: number, field: 'ean13' | 'quantity'): string {
    const errors = this.serverFieldErrorsState();
    const serverError = errors[`lines[${index}].${field}`]
      ?? errors[`lines[${index}]`]
      ?? (index === 0 ? errors[field] : undefined);
    if (serverError) return serverError;
    return this.supplyForm.lines[index]?.[field]().errors()[0]?.message ?? '';
  }

  inputId(field: 'ean13' | 'quantity', index: number): string {
    const base = field === 'ean13' ? 'supplyEan13' : 'supplyQuantity';
    return index === 0 ? base : `${base}-${index}`;
  }

  errorId(field: 'ean13' | 'quantity', index: number): string {
    const base = field === 'ean13' ? 'supply-ean13-error' : 'supply-quantity-error';
    return index === 0 ? base : `supply-${field}-${index}-error`;
  }

  lineTitleId(index: number): string {
    return `supply-line-${index}-title`;
  }

  positionFor(ean13: string): StockPosition | undefined {
    return this.store.result()?.positions.find((position) => position.ean13 === ean13);
  }

  private quantity(value: string): number | string | null {
    const trimmed = value.trim();
    return trimmed === '' ? null : /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
  }

  private errorTarget(): HTMLElement | null {
    const serverField = Object.keys(this.serverFieldErrorsState())[0] ?? '';
    const match = serverField.match(/^lines\[(\d+)\]\.(ean13|quantity)$/);
    if (match) return document.getElementById(this.inputId(match[2] as 'ean13' | 'quantity', Number(match[1])));
    if (serverField === 'ean13' || serverField === 'quantity') return document.getElementById(this.inputId(serverField, 0));
    for (let index = 0; index < this.supplyForm.lines.length; index += 1) {
      if (this.fieldError(index, 'ean13')) return document.getElementById(this.inputId('ean13', index));
      if (this.fieldError(index, 'quantity')) return document.getElementById(this.inputId('quantity', index));
    }
    return document.getElementById('supply-status');
  }
}
