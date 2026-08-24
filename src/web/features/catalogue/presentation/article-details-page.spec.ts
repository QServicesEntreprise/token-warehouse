import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_GATEWAY } from '../application/catalogue-gateway-token';
import { ArticleDetailsStore } from '../application/article-details-store';
import { CatalogueListStore } from '../application/catalogue-list-store';
import { FakeCatalogueGateway } from '../application/testing/fake-catalogue-gateway';
import { ArticleDetailsPage } from './article-details-page';

describe('ArticleDetailsPage', () => {
  const setup = async () => {
    const fake = new FakeCatalogueGateway();
    fake.getHandler = () => of({
      ean13: '0123456789012',
      name: 'Café test',
      type: 'food',
      priceHtCents: 1000,
      dlc: '2030-01-15',
      consumptionModes: ['takeaway'],
      status: 'active',
      priceQuotes: [],
    });
    await TestBed.configureTestingModule({
      imports: [ArticleDetailsPage],
      providers: [
        provideRouter([]),
        ArticleDetailsStore,
        CatalogueListStore,
        { provide: CATALOGUE_GATEWAY, useValue: fake },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ ean13: '0123456789012' })) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ArticleDetailsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fake, fixture };
  };

  const submitForm = async (fixture: ComponentFixture<ArticleDetailsPage>, selector: string) => {
    (fixture.nativeElement.querySelector(selector) as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  };

  it('renders the Article loaded from the route EAN-13', async () => {
    const { fixture } = await setup();

    expect(fixture.nativeElement.querySelector('.article-detail').textContent).toContain('Café test');
    expect(fixture.nativeElement.querySelector('.article-detail').textContent).toContain('0123456789012');
    expect(fixture.nativeElement.querySelector('#lookupEan13').value).toBe('0123456789012');
  });

  it('renders and focuses a local attribute validation error', async () => {
    const { fixture } = await setup();
    const name = fixture.nativeElement.querySelector('#detailName') as HTMLInputElement;
    name.value = '';
    name.dispatchEvent(new Event('input'));

    await submitForm(fixture, '#attribute-update-form');

    expect(fixture.nativeElement.querySelector('#detail-name-error').textContent).toContain('Le nom est requis.');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name).toBe(document.activeElement);
  });

  it('aria-marks and focuses an invalid consumption mode group', async () => {
    const { fake, fixture } = await setup();
    const mode = fixture.nativeElement.querySelector('#detailConsumptionModes input') as HTMLInputElement;
    let updates = 0;
    mode.click();
    fake.updateAttributesHandler = () => {
      updates += 1;
      return throwError(() => ({
        title: 'Modes refusés',
        fieldErrors: { consumptionModes: ['Le serveur refuse ce choix.'] },
      }));
    };

    await submitForm(fixture, '#attribute-update-form');

    const fieldset = fixture.nativeElement.querySelector('#detailConsumptionModes') as HTMLFieldSetElement;
    expect(updates).toBe(1);
    expect(fieldset.getAttribute('aria-invalid')).toBe('true');
    expect(fixture.nativeElement.querySelector('#detail-consumptionModes-error').textContent).toContain('Le serveur refuse ce choix.');
    expect(mode).toBe(document.activeElement);
  });

  it('renders and focuses a local price validation error', async () => {
    const { fixture } = await setup();
    const price = fixture.nativeElement.querySelector('#detailPriceHtCents') as HTMLInputElement;
    price.value = '1.5';
    price.dispatchEvent(new Event('input'));

    await submitForm(fixture, '#price-update-form');

    expect(fixture.nativeElement.querySelector('#priceHt-update-error').textContent).toContain('Le Prix HT doit être un entier de centimes.');
    expect(price.getAttribute('aria-invalid')).toBe('true');
    expect(price).toBe(document.activeElement);
  });
});
