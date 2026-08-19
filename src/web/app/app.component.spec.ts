import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  it('renders the technical shell without a business screen', async () => {
    const fixture = TestBed.configureTestingModule({ imports: [AppComponent] }).createComponent(AppComponent);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('main')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Token Warehouse');
  });
});
