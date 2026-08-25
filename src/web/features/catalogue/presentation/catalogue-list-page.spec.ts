import { LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_GATEWAY } from '../application/catalogue-gateway-token';
import { CatalogueListStore } from '../application/catalogue-list-store';
import { FakeCatalogueGateway } from '../application/testing/fake-catalogue-gateway';
import { CatalogueListPage } from './catalogue-list-page';
import '../../../app/app.config';

describe('CatalogueListPage', () => {
  it('renders Articles returned by the Catalogue seam', async () => {
    const fake = new FakeCatalogueGateway();
    fake.searchHandler = () => of([{
      ean13: '0123456789012',
      name: 'Café test',
      type: 'food',
      priceHtCents: 1000,
      dlc: '2030-01-15',
      consumptionModes: ['takeaway', 'onsite'],
      status: 'active',
      priceQuotes: [
        { saleContext: 'takeaway', taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 }, vatCents: 55, priceTtcCents: 1055 },
        { saleContext: 'onsite', taxRate: { code: 'onsite', ratio: '1/10', numerator: 1, denominator: 10 }, vatCents: 100, priceTtcCents: 1100 },
      ],
    }]);
    await TestBed.configureTestingModule({
      imports: [CatalogueListPage],
      providers: [provideRouter([]), { provide: LOCALE_ID, useValue: 'fr-FR' }, CatalogueListStore, { provide: CATALOGUE_GATEWAY, useValue: fake }],
    }).compileComponents();

    const fixture = TestBed.createComponent(CatalogueListPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#catalog-title').textContent).toContain('Catalogue');
    expect(fixture.nativeElement.querySelector('tbody').textContent).toContain('Café test');
    const headers = [...fixture.nativeElement.querySelectorAll('thead th')].map((header: HTMLElement) => header.textContent);
    expect(headers).toContain('Prix HT');
    expect(headers).toContain('Prix TTC');
    const cells = fixture.nativeElement.querySelectorAll('tbody tr td');
    expect(cells[4].textContent).toContain('10,00');
    expect(cells[5].textContent).toContain('À emporter');
    expect(cells[5].textContent).toContain('10,55');
    expect(cells[5].textContent).toContain('Sur place');
    expect(cells[5].textContent).toContain('11,00');
    expect(fixture.nativeElement.querySelector('tbody').textContent).not.toContain('centimes');
  });
});
