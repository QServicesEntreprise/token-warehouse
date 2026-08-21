import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AppComponent } from './app.component';
import { ArticleResponse } from './article-api.service';

describe('AppComponent', () => {
  it('shows only the fields applicable to the selected classification', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('#dlc')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#packaging')).toBeNull();

    const type = fixture.nativeElement.querySelector('#type') as HTMLSelectElement;
    type.value = 'nonFood';
    type.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#dlc')).toBeNull();
    expect(fixture.nativeElement.querySelector('#consumptionModes')).toBeNull();
    expect(fixture.nativeElement.querySelector('#packaging')).not.toBeNull();
  });

  it('maps a server conflict to the EAN field and live error region', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    const http = TestBed.inject(HttpTestingController);
    const component = fixture.componentInstance;
    component.model.set({
      ean13: '0123456789012',
      type: 'food',
      name: 'Chocolat noir',
      priceHtCents: '199',
      dlc: '2026-12-31',
      consumptionModes: ['takeaway'],
      packaging: '',
    });
    fixture.detectChanges();

    const submission = component.onSubmit(new Event('submit'));
    const request = http.expectOne('/api/articles');
    request.flush(
      {
        code: 'article.ean13.conflict',
        errors: { ean13: ['Un Article utilise déjà cet EAN-13.'] },
      },
      { status: 409, statusText: 'Conflict' },
    );
    await submission;
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.articleForm.ean13().errors().some((error) => error.kind === 'server')).toBe(true);
    expect(fixture.nativeElement.querySelector('#ean13-error').textContent).toContain('EAN');
    expect(fixture.nativeElement.querySelector('#form-error')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#ean13')).toBe(document.activeElement);
    http.verify();
  });

  it('shows two server quotes and submits only the editable HT price', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    const http = TestBed.inject(HttpTestingController);
    const component = fixture.componentInstance;
    const initial = foodArticle(1000, 55, 1055, 100, 1100);
    component.lookupEan.set('0123456789012');
    const loaded = component.onLookup(new Event('submit'));
    const lookup = http.expectOne('/api/articles/0123456789012');
    lookup.flush(initial);
    await loaded;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.price-quote')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('#priceTtcCents')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('1055 centimes');
    expect(fixture.nativeElement.textContent).toContain('1100 centimes');

    const price = fixture.nativeElement.querySelector('#detailPriceHtCents') as HTMLInputElement;
    price.value = '199';
    price.dispatchEvent(new Event('input'));
    const submission = component.onPriceUpdate(new Event('submit'));
    const patch = http.expectOne('/api/articles/0123456789012');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ priceHtCents: 199 });
    patch.flush(foodArticle(199, 11, 210, 20, 219));
    await submission;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('210 centimes');
    expect(fixture.nativeElement.textContent).toContain('219 centimes');
    http.verify();
  });

  it('maps a price update conflict to the HT field and live error region', async () => {
    const fixture = TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).createComponent(AppComponent);
    const http = TestBed.inject(HttpTestingController);
    const component = fixture.componentInstance;
    component.lookupEan.set('0123456789012');
    const loaded = component.onLookup(new Event('submit'));
    const lookup = http.expectOne('/api/articles/0123456789012');
    lookup.flush(foodArticle(1000, 55, 1055, 100, 1100));
    await loaded;
    fixture.detectChanges();

    const price = fixture.nativeElement.querySelector('#detailPriceHtCents') as HTMLInputElement;
    price.value = '199';
    price.dispatchEvent(new Event('input'));
    const submission = component.onPriceUpdate(new Event('submit'));
    const patch = http.expectOne('/api/articles/0123456789012');
    patch.flush(
      {
        code: 'article.priceHt.conflict',
        title: 'Le Prix HT ne peut pas être modifié.',
        errors: { priceHtCents: ['Prix HT en conflit.'] },
      },
      { status: 409, statusText: 'Conflict' },
    );
    await submission;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#price-update-error').textContent).toContain('Prix HT');
    expect(fixture.nativeElement.querySelector('#priceHt-update-error').textContent).toContain('conflit');
    expect(fixture.nativeElement.querySelector('#detailPriceHtCents')).toBe(document.activeElement);
    http.verify();
  });
});

function foodArticle(
  priceHtCents: number,
  takeawayVatCents: number,
  takeawayTtcCents: number,
  onsiteVatCents: number,
  onsiteTtcCents: number,
): ArticleResponse {
  return {
    ean13: '0123456789012',
    type: 'food',
    name: 'Chocolat noir',
    priceHtCents,
    isActive: true,
    dlc: '2026-12-31',
    consumptionModes: ['takeaway', 'onsite'],
    priceQuotes: [
      {
        saleContext: 'takeaway',
        taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
        vatCents: takeawayVatCents,
        priceTtcCents: takeawayTtcCents,
      },
      {
        saleContext: 'onsite',
        taxRate: { code: 'onsite', ratio: '1/10', numerator: 1, denominator: 10 },
        vatCents: onsiteVatCents,
        priceTtcCents: onsiteTtcCents,
      },
    ],
  };
}
