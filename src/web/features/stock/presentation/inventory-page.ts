import { AfterViewInit, ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormField, FormRoot, applyEach, form, pattern, required, submit } from '@angular/forms/signals';
import { InventoryStore } from '../application/inventory-store';
import { stockLabels } from './stock-labels';

type InventoryReceipt = NonNullable<ReturnType<InventoryStore['receipt']>>;
type InventoryPosition = InventoryReceipt['lines'][number]['position'];

interface InventoryFormModel {
  lines: { ean13: string; countedQuantity: string }[];
}

const emptyLine = () => ({ ean13: '', countedQuantity: '' });

@Component({
  selector: 'app-inventory-page',
  standalone: true,
  imports: [FormField, FormRoot],
  templateUrl: './inventory-page.html',
  styleUrl: './inventory-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventoryPage implements AfterViewInit, OnInit {
  readonly store = inject(InventoryStore);
  private readonly modelState = signal<InventoryFormModel>({ lines: [emptyLine()] });
  private readonly clientErrorState = signal('');
  readonly model = this.modelState.asReadonly();
  readonly clientError = this.clientErrorState.asReadonly();
  readonly inventoryForm = form(this.modelState, (path) => {
    applyEach(path.lines, (line) => {
      required(line.ean13, { message: 'L’EAN-13 est requis.' });
      pattern(line.ean13, /^\d{13}$/, { message: 'L’EAN-13 doit contenir 13 chiffres.' });
      required(line.countedQuantity, { message: 'La quantité comptée est requise.' });
      pattern(line.countedQuantity, /^\d+$/, { message: 'La quantité comptée doit être un entier supérieur ou égal à zéro.' });
    });
  });

  ngOnInit(): void {
    this.store.restore();
  }

  ngAfterViewInit(): void {
    const title = document.getElementById('inventory-title');
    if (title) {
      title.focus({ preventScroll: true });
      title.scrollIntoView?.();
    }
  }

  addLine(): void {
    this.modelState.update((model) => ({ lines: [...model.lines, emptyLine()] }));
  }

  removeLine(index: number): void {
    if (this.model().lines.length > 1) {
      this.modelState.update((model) => ({
        lines: model.lines.filter((_, lineIndex) => lineIndex !== index),
      }));
    }
  }

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.clientErrorState.set('');
    let succeeded = false;
    await submit(this.inventoryForm, {
      action: async () => {
        const commands = this.model().lines.map((line) => ({
          ean13: line.ean13,
          countedQuantity: Number(line.countedQuantity),
        }));
        succeeded = await this.store.record(commands);
        return undefined;
      },
      onInvalid: () => this.clientErrorState.set('Corrigez les erreurs signalées avant de continuer.'),
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (succeeded) {
      document.getElementById('inventory-result')?.focus();
    } else {
      this.focusError();
    }
  }

  clearFieldError(index: number, field: 'ean13' | 'countedQuantity'): void {
    this.store.clearFieldError(`lines[${index}].${field}`);
    if (index === 0) {
      this.store.clearFieldError(field);
    }
  }

  fieldId(field: 'ean13' | 'countedQuantity', index: number): string {
    return `inventory-${field}${index === 0 ? '' : `-${index}`}`;
  }

  fieldError(index: number, field: 'ean13' | 'countedQuantity'): string {
    const serverError = this.store.fieldErrors()[`lines[${index}].${field}`]?.[0]
      ?? (index === 0 ? this.store.fieldErrors()[field]?.[0] : undefined);
    if (serverError) {
      return serverError;
    }
    const line = this.inventoryForm.lines[index];
    return field === 'ean13'
      ? line?.ean13().errors()[0]?.message ?? ''
      : line?.countedQuantity().errors()[0]?.message ?? '';
  }

  formatDifference(difference: number): string {
    return difference > 0 ? `+${difference}` : String(difference);
  }

  formatAvailability(availability: InventoryPosition['availability']): string {
    return stockLabels.availability[availability];
  }

  formatReason(reason: InventoryPosition['nonSellableReason']): string {
    return reason ? stockLabels.reason[reason] : '—';
  }

  private focusError(): void {
    const field = Object.keys(this.store.fieldErrors())
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))[0];
    const match = /^(?:lines\[(\d+)\]\.)?(ean13|countedQuantity)$/.exec(field ?? '');
    document.getElementById(match
      ? this.fieldId(match[2] as 'ean13' | 'countedQuantity', Number(match[1] ?? 0))
      : this.fieldId('countedQuantity', 0))?.focus();
  }
}
