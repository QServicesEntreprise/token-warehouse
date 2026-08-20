import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AppComponent } from './app.component';

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
});
