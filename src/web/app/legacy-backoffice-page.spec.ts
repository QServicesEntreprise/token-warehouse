import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { LegacyBackofficePage } from './legacy-backoffice-page';

describe('LegacyBackofficePage', () => {
  it('keeps the retired shell constructible', () => {
    const fixture = TestBed.configureTestingModule({
      imports: [LegacyBackofficePage],
    }).createComponent(LegacyBackofficePage);

    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#page-title')?.textContent).toContain('Créer et consulter un Article');
  });
});
