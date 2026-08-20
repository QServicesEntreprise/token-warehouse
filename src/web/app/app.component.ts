import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main aria-labelledby="page-title">
      <p class="eyebrow">Technical shell</p>
      <h1 id="page-title">Token Warehouse</h1>
      <p>The runtime is ready for the first domain slice.</p>
    </main>
  `,
})
export class AppComponent {}
