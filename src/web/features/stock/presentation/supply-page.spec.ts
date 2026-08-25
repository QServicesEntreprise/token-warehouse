import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STOCK_GATEWAY } from '../application/stock-gateway-token';
import { SupplyStore } from '../application/supply-store';
import type { SupplyResult } from '../domain/supply-result';
import { SupplyPage } from './supply-page';

const unitResult: SupplyResult = {
  operation: {
    id: 'supply-1',
    occurredAt: '2030-01-15T10:00:00Z',
    lines: [{ lineNumber: 1, ean13: '0123456789012', quantity: 3 }],
  },
  positions: [{
    ean13: '0123456789012', name: 'Article reçu', physicalQuantity: 11, sellableQuantity: 7,
    nonSellableQuantity: 4, availability: 'available', nonSellableReason: null,
  }],
};

const fill = (fixture: ComponentFixture<SupplyPage>, selector: string, value: string) => {
  const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
};

describe('SupplyPage', () => {
  const recordSupply = vi.fn();
  const recordBulkSupply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [SupplyPage],
      providers: [
        SupplyStore,
        { provide: STOCK_GATEWAY, useValue: { list: vi.fn(), getByEan13: vi.fn(), recordSupply, recordBulkSupply } },
      ],
    });
  });

  it('submits the unit Signal Form and presents the complete server result', async () => {
    recordSupply.mockReturnValue(of(unitResult));
    const fixture = TestBed.createComponent(SupplyPage);
    fixture.detectChanges();
    fill(fixture, '#supplyEan13', '0123456789012');
    fill(fixture, '#supplyQuantity', '3');

    await fixture.componentInstance.onSubmit(new Event('submit'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(recordSupply).toHaveBeenCalledWith({ ean13: '0123456789012', quantity: 3 });
    expect(fixture.nativeElement.querySelector('#supply-result').textContent).toContain('11 unités');
    expect(fixture.nativeElement.querySelector('#supply-result').textContent).toContain('7 unités');
    expect(fixture.nativeElement.querySelector('#supply-status')).toBe(document.activeElement);
  });

  it('does not focus a replacement route after the page is destroyed', async () => {
    const pending = new Subject<SupplyResult>();
    recordSupply.mockReturnValue(pending);
    const fixture = TestBed.createComponent(SupplyPage);
    fixture.detectChanges();
    fill(fixture, '#supplyEan13', '0123456789012');
    fill(fixture, '#supplyQuantity', '3');
    const submission = fixture.componentInstance.onSubmit(new Event('submit'));
    fixture.nativeElement.querySelector('#supply-status').id = 'old-supply-status';
    fixture.destroy();
    const replacementStatus = document.createElement('button');
    replacementStatus.id = 'supply-status';
    document.body.append(replacementStatus);

    pending.next(unitResult);
    pending.complete();
    await submission;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(document.activeElement).not.toBe(replacementStatus);
    replacementStatus.remove();
  });

  it('keeps and focuses every bulk draft after rejection, then presents every accepted line', async () => {
    const bulkResult: SupplyResult = {
      operation: {
        id: 'bulk-1', occurredAt: '2030-01-15T10:00:00Z',
        lines: [
          { lineNumber: 1, ean13: '0123456789012', quantity: 3 },
          { lineNumber: 2, ean13: '5901234123457', quantity: 2 },
        ],
      },
      positions: [unitResult.positions[0]!, {
        ...unitResult.positions[0]!, ean13: '5901234123457', physicalQuantity: 7, sellableQuantity: 7,
      }],
    };
    recordBulkSupply
      .mockReturnValueOnce(throwError(() => ({
        title: 'La livraison est invalide.',
        fieldErrors: { 'lines[1].quantity': ['La quantité est invalide.'] },
      })))
      .mockReturnValueOnce(of(bulkResult));
    const fixture = TestBed.createComponent(SupplyPage);
    fixture.detectChanges();
    fixture.componentInstance.addLine();
    fixture.detectChanges();
    fill(fixture, '#supplyEan13', '0123456789012');
    fill(fixture, '#supplyQuantity', '3');
    fill(fixture, '#supplyEan13-1', '5901234123457');
    fill(fixture, '#supplyQuantity-1', '0');

    await fixture.componentInstance.onSubmit(new Event('submit'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('#supplyEan13') as HTMLInputElement).value).toBe('0123456789012');
    expect((fixture.nativeElement.querySelector('#supplyQuantity') as HTMLInputElement).value).toBe('3');
    expect((fixture.nativeElement.querySelector('#supplyEan13-1') as HTMLInputElement).value).toBe('5901234123457');
    expect((fixture.nativeElement.querySelector('#supplyQuantity-1') as HTMLInputElement).value).toBe('0');
    expect(fixture.nativeElement.querySelector('#supply-quantity-1-error').textContent).toContain('invalide');
    expect(fixture.nativeElement.querySelector('#supplyQuantity-1')).toBe(document.activeElement);

    fill(fixture, '#supplyQuantity-1', '2');
    await fixture.componentInstance.onSubmit(new Event('submit'));
    fixture.detectChanges();

    expect(recordBulkSupply).toHaveBeenLastCalledWith({ lines: [
      { ean13: '0123456789012', quantity: 3 },
      { ean13: '5901234123457', quantity: 2 },
    ] });
    expect(fixture.nativeElement.querySelector('#supply-result').textContent).toContain('11 unités');
    expect(fixture.nativeElement.querySelector('#supply-result').textContent).toContain('7 unités');
  });

  it('rebases a rejected bulk field when an earlier draft line is removed', async () => {
    recordBulkSupply.mockReturnValue(throwError(() => ({
      title: 'La livraison est invalide.',
      fieldErrors: { 'lines[1].quantity': ['La quantité est invalide.'] },
    })));
    const fixture = TestBed.createComponent(SupplyPage);
    fixture.detectChanges();
    fixture.componentInstance.addLine();
    fixture.detectChanges();
    fill(fixture, '#supplyEan13', '0123456789012');
    fill(fixture, '#supplyQuantity', '3');
    fill(fixture, '#supplyEan13-1', '5901234123457');
    fill(fixture, '#supplyQuantity-1', '0');
    await fixture.componentInstance.onSubmit(new Event('submit'));
    fixture.detectChanges();

    fixture.componentInstance.removeLine(0);
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('#supplyEan13') as HTMLInputElement).value).toBe('5901234123457');
    expect(fixture.nativeElement.querySelector('#supply-quantity-error').textContent).toContain('invalide');
  });
});
