import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_GATEWAY } from '../application/catalogue-gateway-token';
import { ArticleDetailsStore } from '../application/article-details-store';
import { FakeCatalogueGateway } from '../application/testing/fake-catalogue-gateway';
import { ArticleDetailsPage } from './article-details-page';

describe('ArticleDetailsPage', () => {
  it('renders the Article loaded from the route EAN-13', async () => {
    const fake = new FakeCatalogueGateway();
    fake.getHandler = () => of({
      ean13: '0123456789012',
      name: 'Café test',
      type: 'food',
      priceHtCents: 1000,
      dlc: '2030-01-15',
      consumptionModes: ['takeaway'],
      isActive: true,
      status: 'active',
      priceQuotes: [],
    });
    await TestBed.configureTestingModule({
      imports: [ArticleDetailsPage],
      providers: [
        provideRouter([]),
        ArticleDetailsStore,
        { provide: CATALOGUE_GATEWAY, useValue: fake },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ ean13: '0123456789012' })) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ArticleDetailsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.article-detail').textContent).toContain('Café test');
    expect(fixture.nativeElement.querySelector('.article-detail').textContent).toContain('0123456789012');
  });
});
