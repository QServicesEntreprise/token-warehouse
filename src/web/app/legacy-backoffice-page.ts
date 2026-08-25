import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-legacy-backoffice-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main aria-labelledby="page-title">
      <header class="page-header">
        <p class="eyebrow">Catalogue d’Articles</p>
        <h1 id="page-title">Créer et consulter un Article</h1>
        <p>Une référence EAN-13, un Prix HT en centimes et les attributs de sa classification.</p>
      </header>
    </main>
  `,
})
export class LegacyBackofficePage {}
