import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_GATEWAY } from '../application/catalogue-gateway-token';
import { ArticleCreateStore } from '../application/article-create-store';
import { CatalogueListStore } from '../application/catalogue-list-store';
import { FakeCatalogueGateway } from '../application/testing/fake-catalogue-gateway';
import { ArticleCreatePage } from './article-create-page';

describe('ArticleCreatePage', () => {
  it('shows only fields applicable to the selected classification', async () => {
    await TestBed.configureTestingModule({
      imports: [ArticleCreatePage],
      providers: [provideRouter([]), ArticleCreateStore, CatalogueListStore, { provide: CATALOGUE_GATEWAY, useValue: new FakeCatalogueGateway() }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ArticleCreatePage);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#dlc')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#packaging')).toBeNull();
    const type = fixture.nativeElement.querySelector('#type') as HTMLSelectElement;
    type.value = 'nonFood';
    type.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#dlc')).toBeNull();
    expect(fixture.nativeElement.querySelector('#packaging')).not.toBeNull();
  });
});
