import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { CATALOGUE_GATEWAY } from '../application/catalogue-gateway-token';
import { ArticleDetailsStore } from '../application/article-details-store';
import { CatalogueListStore } from '../application/catalogue-list-store';
import { FakeCatalogueGateway } from '../application/testing/fake-catalogue-gateway';
import { Article } from '../domain/article';
import { ArticleDetailsPage } from './article-details-page';

describe('ArticleDetailsPage', () => {
  const setup = async () => {
    const fake = new FakeCatalogueGateway();
    const paramMap = new BehaviorSubject(convertToParamMap({ ean13: '0123456789012' }));
    fake.getHandler = (ean13) => of(fakeArticle(ean13, ean13 === '0123456789012' ? 'Café test' : 'Thé test'));
    await TestBed.configureTestingModule({
      imports: [ArticleDetailsPage],
      providers: [
        provideRouter([]),
        { provide: CATALOGUE_GATEWAY, useValue: fake },
        { provide: ActivatedRoute, useValue: { paramMap } },
      ],
    }).overrideComponent(ArticleDetailsPage, { add: { providers: [ArticleDetailsStore, CatalogueListStore] } }).compileComponents();

    const fixture = TestBed.createComponent(ArticleDetailsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockImplementation(async (commands) => {
      paramMap.next(convertToParamMap({ ean13: String(commands.at(-1)) }));
      return true;
    });
    return { fake, fixture, router };
  };

  const submitForm = async (fixture: ComponentFixture<ArticleDetailsPage>, selector: string) => {
    (fixture.nativeElement.querySelector(selector) as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  };

  const startLookup = (fixture: ComponentFixture<ArticleDetailsPage>, ean13: string) => {
    const input = fixture.nativeElement.querySelector('#lookupEan13') as HTMLInputElement;
    input.value = ean13;
    input.dispatchEvent(new Event('input'));
    (fixture.nativeElement.querySelector('.lookup') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };

  const lookup = async (fixture: ComponentFixture<ArticleDetailsPage>, ean13: string) => {
    startLookup(fixture, ean13);
    await fixture.whenStable();
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

  it('does not announce a previous Article mutation after route navigation', async () => {
    const { fake, fixture, router } = await setup();
    fake.updatePriceHandler = () => of({
      ...fakeArticle('0123456789012', 'Café test'),
      priceHtCents: 1200,
    });

    await submitForm(fixture, '#price-update-form');
    expect(fixture.nativeElement.querySelector('#catalog-lifecycle-status').textContent).toContain('mis à jour');

    await lookup(fixture, '2222222222222');

    expect(router.navigate).toHaveBeenCalledWith(['/catalogue', '2222222222222']);
    expect(fixture.nativeElement.querySelector('#detail-title').textContent).toContain('Thé test');
    expect(fixture.nativeElement.querySelector('#catalog-lifecycle-status').textContent).toBe('');
    expect(fixture.nativeElement.querySelector('#price-update-error').textContent).toBe('');
  });

  it('does not attach a previous Article field error after route navigation', async () => {
    const { fake, fixture, router } = await setup();
    fake.updatePriceHandler = () => throwError(() => ({
      title: 'Prix refusé',
      fieldErrors: { priceHtCents: ['Le Prix HT est invalide.'] },
    }));

    await submitForm(fixture, '#price-update-form');
    expect(fixture.nativeElement.querySelector('#priceHt-update-error').textContent).toContain('Le Prix HT est invalide.');

    await lookup(fixture, '2222222222222');

    const price = fixture.nativeElement.querySelector('#detailPriceHtCents') as HTMLInputElement;
    expect(router.navigate).toHaveBeenCalledWith(['/catalogue', '2222222222222']);
    expect(fixture.nativeElement.querySelector('#detail-title').textContent).toContain('Thé test');
    expect(fixture.nativeElement.querySelector('#priceHt-update-error')).toBeNull();
    expect(price.getAttribute('aria-invalid')).toBeNull();
    expect(fixture.nativeElement.querySelector('#price-update-error').textContent).toBe('');
  });

  it('does not focus the next Article after a superseded price update completes', async () => {
    const { fake, fixture } = await setup();
    let committed = fakeArticle('0123456789012', 'Café test');
    fake.getHandler = (ean13) => of(ean13 === committed.ean13 ? committed : fakeArticle(ean13, 'Thé test'));
    const pendingUpdate = new Subject<Article>();
    fake.updatePriceHandler = () => pendingUpdate;
    (fixture.nativeElement.querySelector('#price-update-form') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    startLookup(fixture, '2222222222222');
    await Promise.resolve();
    fixture.detectChanges();
    startLookup(fixture, '0123456789012');
    await Promise.resolve();
    fixture.detectChanges();
    committed = { ...committed, priceHtCents: 1200 };
    pendingUpdate.next(committed);
    pendingUpdate.complete();
    await Promise.resolve();
    await Promise.resolve();
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    const nextPrice = fixture.nativeElement.querySelector('#detailPriceHtCents') as HTMLInputElement;
    expect(fixture.nativeElement.querySelector('#detail-title').textContent).toContain('Café test');
    expect(fixture.nativeElement.querySelector('.article-detail').textContent).toContain('1200 centimes');
    expect(fixture.nativeElement.querySelector('#price-update-error').textContent).toBe('');
    expect(fixture.componentInstance.priceForm().errors()).toHaveLength(0);
    expect(nextPrice).not.toBe(document.activeElement);
  });

  it('does not focus the next Article after a superseded lifecycle update completes', async () => {
    const { fake, fixture } = await setup();
    let committed = fakeArticle('0123456789012', 'Café test');
    fake.getHandler = (ean13) => of(ean13 === committed.ean13 ? committed : fakeArticle(ean13, 'Thé test'));
    const pendingArchive = new Subject<Article>();
    fake.archiveHandler = () => pendingArchive;
    const mutation = fixture.componentInstance.toggleLifecycle();
    await Promise.resolve();

    startLookup(fixture, '2222222222222');
    await Promise.resolve();
    fixture.detectChanges();
    startLookup(fixture, '0123456789012');
    await Promise.resolve();
    fixture.detectChanges();
    committed = { ...committed, status: 'archived' };
    pendingArchive.next(committed);
    pendingArchive.complete();
    await Promise.resolve();
    await Promise.resolve();
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#detail-title').textContent).toContain('Café test');
    expect(fixture.nativeElement.querySelector('.article-detail').textContent).toContain('Archivé');
    expect(fixture.nativeElement.querySelector('#catalog-lifecycle-status').textContent).toBe('');
    expect(fixture.nativeElement.querySelector('#detail-lifecycle-action')).not.toBe(document.activeElement);
  });

  it('does not focus another route after a pending lifecycle update completes', async () => {
    const { fake, fixture } = await setup();
    const pendingArchive = new Subject<Article>();
    fake.archiveHandler = () => pendingArchive;
    const mutation = fixture.componentInstance.toggleLifecycle();
    await Promise.resolve();
    fixture.destroy();
    const listStatus = document.createElement('p');
    listStatus.id = 'catalog-lifecycle-status';
    listStatus.tabIndex = -1;
    document.body.appendChild(listStatus);

    pendingArchive.next({ ...fakeArticle('0123456789012', 'Café test'), status: 'archived' });
    pendingArchive.complete();
    await mutation;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(listStatus).not.toBe(document.activeElement);
    listStatus.remove();
  });

  it('refreshes a reopened Article after the previous detail store commits', async () => {
    const { fake, fixture } = await setup();
    let committed = fakeArticle('0123456789012', 'Café test');
    fake.getHandler = () => of(committed);
    const pendingUpdate = new Subject<Article>();
    fake.updatePriceHandler = () => pendingUpdate;
    (fixture.nativeElement.querySelector('#price-update-form') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    fixture.destroy();

    const reopened = TestBed.createComponent(ArticleDetailsPage);
    reopened.detectChanges();
    await reopened.whenStable();
    reopened.detectChanges();
    expect(reopened.nativeElement.querySelector('.article-detail').textContent).toContain('1000 centimes');

    committed = { ...committed, priceHtCents: 1200 };
    pendingUpdate.next(committed);
    pendingUpdate.complete();
    await Promise.resolve();
    await Promise.resolve();
    await reopened.whenStable();
    reopened.detectChanges();

    expect(reopened.nativeElement.querySelector('.article-detail').textContent).toContain('1200 centimes');
  });
});

const fakeArticle = (ean13: string, name: string): Article => ({
  ean13,
  name,
  type: 'food',
  priceHtCents: 1000,
  dlc: '2030-01-15',
  consumptionModes: ['takeaway'],
  status: 'active',
  priceQuotes: [],
});
