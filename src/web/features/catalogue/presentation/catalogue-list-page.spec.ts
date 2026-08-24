import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_GATEWAY } from '../application/catalogue-gateway-token';
import { CatalogueListStore } from '../application/catalogue-list-store';
import { FakeCatalogueGateway } from '../application/testing/fake-catalogue-gateway';
import { CatalogueListPage } from './catalogue-list-page';

describe('CatalogueListPage', () => {
  it('renders Articles returned by the Catalogue seam', async () => {
    const fake = new FakeCatalogueGateway();
    fake.searchHandler = () => of([{
      ean13: '0123456789012',
      name: 'Café test',
      type: 'food',
      priceHtCents: 1000,
      dlc: '2030-01-15',
      consumptionModes: ['takeaway'],
      status: 'active',
    }]);
    await TestBed.configureTestingModule({
      imports: [CatalogueListPage],
      providers: [provideRouter([]), CatalogueListStore, { provide: CATALOGUE_GATEWAY, useValue: fake }],
    }).compileComponents();

    const fixture = TestBed.createComponent(CatalogueListPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#catalog-title').textContent).toContain('Catalogue');
    expect(fixture.nativeElement.querySelector('tbody').textContent).toContain('Café test');
  });
});
