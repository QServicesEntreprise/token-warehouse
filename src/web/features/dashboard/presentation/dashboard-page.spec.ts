import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { DashboardGateway } from '../application/dashboard-gateway';
import { DashboardStore } from '../application/dashboard-store';
import { DashboardHttpGateway } from '../infrastructure/dashboard-http-gateway';
import { DashboardPage } from './dashboard-page';

describe('DashboardPage', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  const createPage = () => {
    const fixture = TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        DashboardStore,
        { provide: DashboardGateway, useClass: DashboardHttpGateway },
      ],
    }).createComponent(DashboardPage);
    fixture.detectChanges();
    return { fixture, http: TestBed.inject(HttpTestingController) };
  };

  it('renders current Stock, alerts, flows and financial projections', async () => {
    const { fixture, http } = createPage();
    http.expectOne('/health').flush({
      status: 'ok',
      provider: 'test',
      warehouseDate: '2030-01-15',
      currentMonth: { from: '2030-01-01', to: '2030-01-31' },
    });
    http.expectOne(request => request.url === '/api/dashboard').flush({
      kpis: { physicalStock: 9, sellableStock: 5, nonSellableStock: 4 },
      alerts: {
        outOfStock: [],
        notSellable: [{
          ean13: '2345678901234',
          name: 'Article archivé',
          articleType: 'nonFood',
          lifecycleStatus: 'ARCHIVED',
          physicalStock: 4,
          sellableStock: 0,
          nonSellableStock: 4,
          availability: 'NOT_SELLABLE',
          reason: 'ARCHIVED',
        }],
      },
      stockByArticle: [{
        ean13: '0123456789012',
        name: 'Alimentaire vendable',
        articleType: 'food',
        lifecycleStatus: 'ACTIVE',
        physicalStock: 5,
        sellableStock: 5,
        nonSellableStock: 0,
        availability: 'AVAILABLE',
        reason: null,
      }],
      flowsByDay: [{ date: '2030-01-15', supplies: 3, sales: 1 }],
      financial: {
        revenueHtCents: 1000,
        revenueTtcCents: 1055,
        vatCollectedCents: 55,
        byTaxRate: [{
          taxRate: { code: 'takeaway', ratio: '11/200', numerator: 11, denominator: 200 },
          amountHtCents: 1000,
          vatCents: 55,
          amountTtcCents: 1055,
        }],
      },
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('main[aria-labelledby="dashboard-title"] > div h1#dashboard-title')?.textContent)
      .toContain('Dashboard');
    const headingLevels = Array.from(
      fixture.nativeElement.querySelectorAll('h1, h2, h3, h4'),
      (heading: Element) => Number(heading.tagName[1]),
    );
    expect(headingLevels.every((level, index) => index === 0 || level <= headingLevels[index - 1] + 1))
      .toBe(true);
    expect(fixture.nativeElement.querySelector('#dashboard-state').textContent).toContain('Article suivi');
    expect(fixture.nativeElement.querySelector('#dashboard-kpi-physical').textContent).toContain('9 unités');
    expect(fixture.nativeElement.querySelector('#dashboard-alert-not-sellable').textContent)
      .toContain('Article archivé');
    expect(fixture.nativeElement.querySelector('#dashboard-flows-table').textContent).toContain('3 unités');
    expect(fixture.nativeElement.querySelector('#dashboard-financial-revenue-ttc').textContent)
      .toContain('10,55');
  });

  it('preserves filters and restores focus after a Problem Details error', async () => {
    const { fixture, http } = createPage();
    http.expectOne('/health').flush({
      status: 'ok',
      provider: 'test',
      warehouseDate: '2030-03-15',
      currentMonth: { from: '2030-03-01', to: '2030-03-31' },
    });
    http.expectOne(request => request.url === '/api/dashboard').flush({
      kpis: { physicalStock: 0, sellableStock: 0, nonSellableStock: 0 },
      alerts: { outOfStock: [], notSellable: [] },
      stockByArticle: [],
      flowsByDay: [],
      financial: null,
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const setValue = (selector: string, value: string) => {
      const control = fixture.nativeElement.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
      control.value = value;
      control.dispatchEvent(new Event('change'));
    };
    setValue('#dashboard-from', '2030-03-20');
    setValue('#dashboard-to', '2030-03-15');
    setValue('#dashboard-type', 'food');
    setValue('#dashboard-mode', 'onsite');
    setValue('#dashboard-packaging', 'new');
    (fixture.nativeElement.querySelector('#dashboard-filters') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const filtered = http.expectOne(request => (
      request.url === '/api/dashboard'
      && request.params.get('from') === '2030-03-20'
      && request.params.get('to') === '2030-03-15'
      && request.params.get('type') === 'food'
      && request.params.get('mode') === 'onsite'
      && request.params.get('packaging') === 'new'
    ));
    filtered.flush({
      title: 'La période est invalide.',
      code: 'dashboard.reversed_period',
      errors: { from: ['La date de début est invalide.'] },
    }, { status: 400, statusText: 'Bad Request' });
    await fixture.whenStable();
    fixture.detectChanges();

    const from = fixture.nativeElement.querySelector('#dashboard-from') as HTMLInputElement;
    expect(from.value).toBe('2030-03-20');
    expect((fixture.nativeElement.querySelector('#dashboard-type') as HTMLSelectElement).value).toBe('food');
    expect((fixture.nativeElement.querySelector('#dashboard-mode') as HTMLSelectElement).value).toBe('onsite');
    expect((fixture.nativeElement.querySelector('#dashboard-packaging') as HTMLSelectElement).value).toBe('new');
    expect(from.getAttribute('aria-describedby')).toBe('dashboard-from-error');
    expect(fixture.nativeElement.querySelector('#dashboard-state [role="alert"]').textContent)
      .toContain('période est invalide');
    expect(from).toBe(document.activeElement);
  });

  it('announces loading, empty and error states and retries the same read', async () => {
    const { fixture, http } = createPage();
    expect(fixture.nativeElement.querySelector('#dashboard-state').textContent).toContain('Chargement');
    http.expectOne('/health').flush({
      status: 'ok',
      provider: 'test',
      warehouseDate: '2030-01-15',
      currentMonth: { from: '2030-01-01', to: '2030-01-31' },
    });
    http.expectOne(request => request.url === '/api/dashboard').flush({
      kpis: { physicalStock: 0, sellableStock: 0, nonSellableStock: 0 },
      alerts: { outOfStock: [], notSellable: [] },
      stockByArticle: [],
      flowsByDay: [],
      financial: null,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#dashboard-state').textContent).toContain('Aucun Article');

    (fixture.nativeElement.querySelector('#dashboard-submit') as HTMLButtonElement).click();
    http.expectOne(request => request.url === '/api/dashboard').flush(
      { title: 'Le Dashboard est indisponible.' },
      { status: 500, statusText: 'Server Error' },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#dashboard-state [role="alert"]').textContent)
      .toContain('indisponible');
    expect(fixture.nativeElement.querySelector('#dashboard-table')).toBeNull();

    (fixture.nativeElement.querySelector('#dashboard-state button') as HTMLButtonElement).click();
    http.expectOne(request => request.url === '/api/dashboard').flush({
      kpis: { physicalStock: 1, sellableStock: 1, nonSellableStock: 0 },
      alerts: { outOfStock: [], notSellable: [] },
      stockByArticle: [{
        ean13: '0123456789012',
        name: 'Article retrouvé',
        articleType: 'food',
        lifecycleStatus: 'ACTIVE',
        physicalStock: 1,
        sellableStock: 1,
        nonSellableStock: 0,
        availability: 'AVAILABLE',
        reason: null,
      }],
      flowsByDay: [],
      financial: null,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#dashboard-table').textContent).toContain('Article retrouvé');
  });

  it('keeps accessible controls visible when the calendar bootstrap fails', async () => {
    const { fixture, http } = createPage();
    http.expectOne('/health').flush(
      { title: 'Persistence unavailable' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#dashboard-state [role="alert"]').textContent)
      .toContain('Persistence unavailable');
    expect(fixture.nativeElement.querySelector('#dashboard-filters')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('label[for="dashboard-from"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.dashboard-calendar-note').textContent)
      .toContain('indisponible');

    (fixture.nativeElement.querySelector('#dashboard-state button') as HTMLButtonElement).click();
    http.expectOne('/health').flush({
      status: 'ok',
      provider: 'test',
      warehouseDate: '2030-01-15',
      currentMonth: { from: '2030-01-01', to: '2030-01-31' },
    });
    http.expectOne(request => request.url === '/api/dashboard').flush({
      kpis: { physicalStock: 0, sellableStock: 0, nonSellableStock: 0 },
      alerts: { outOfStock: [], notSellable: [] },
      stockByArticle: [],
      flowsByDay: [],
      financial: null,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#dashboard-state').textContent).toContain('Aucun Article');
  });
});
