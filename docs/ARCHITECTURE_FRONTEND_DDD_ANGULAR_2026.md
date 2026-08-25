# Token Warehouse — Proposition d’architecture frontend DDD Angular 2026

## 1. Décision

Le frontend doit devenir un monolithe Angular modulaire, découpé par capacités métier et chargé par routes :

1. **Catalogue** : identité, classification, prix et cycle de vie des Articles ;
2. **Stock** : positions, Approvisionnements, Inventaires, Contre-mouvements et Historique ;
3. **Ventes** : recherche d’un Article vendable, contexte tarifaire et validation d’une Vente ;
4. **Pilotage** : Dashboard et projections de lecture agrégées.

Chaque capacité contient quatre responsabilités explicites :

```text
presentation ─────► application ─────► domain
                         ▲                 ▲
                         │                 │
                    infrastructure ────────┘

app = composition des routes, providers et navigation
```

Le frontend reste un adapter du domaine porté par le backend. Il ne recrée ni les aggregates C#, ni les règles de TVA, ni les règles de vendabilité. Son DDD consiste à protéger le vocabulaire métier, les frontières fonctionnelles et les dépendances.

Cette cible ne nécessite ni NgRx, ni Nx, ni microfrontend, ni bus de commandes, ni repository générique.

## 2. Analyse de l’existant

### 2.1 Points solides à conserver

- Angular 22 avec composants standalone ;
- application déjà exécutée sans `zone.js` ;
- `ChangeDetectionStrategy.OnPush` ;
- Signals, `computed` et Signal Forms ;
- injection avec `inject()` ;
- templates stricts et TypeScript en mode `strict` ;
- appels HTTP typés ;
- erreurs Problem Details exploitables par les formulaires ;
- états de chargement, erreur et absence de données visibles ;
- protections contre les réponses HTTP obsolètes ;
- comportements d’accessibilité : annonces, focus et boutons désactivés ;
- Vitest pour les composants, Playwright pour les parcours et un test d’architecture sans dépendance additionnelle.

### 2.2 Dette structurante

| Constat | Impact |
| --- | --- |
| `app.component.ts` contient 2 971 lignes | le shell, les vues, les formulaires, les appels HTTP et l’orchestration de tous les parcours ont le même cycle de modification |
| le template racine est inline et couvre l’ensemble du back-office | aucun chargement paresseux et navigation interne difficile à isoler |
| le composant racine injecte six clients API | le shell connaît Catalogue, Stock, Inventaire, Contre-mouvement, Ventes et Historique |
| au moins 42 Signals, formulaires ou valeurs dérivées sont détenus par le composant racine | l’état de parcours n’a pas de propriétaire fonctionnel clair |
| douze compteurs de requêtes gèrent manuellement la concurrence | la gestion d’une requête peut affecter un parcours voisin |
| `app.component.spec.ts` contient 2 874 lignes et 40 tests | les tests de toutes les capacités doivent instancier le même composant |
| sept fichiers `*-api.service.ts` contiennent 70 déclarations exportées | les DTO, types métier et clients HTTP sont fusionnés ; la règle « un fichier par déclaration » n’est pas respectée |
| les DTO suffixés `Response` sont utilisés directement par les composants | le format du transport HTTP devient le modèle de présentation |
| Ventes et Pilotage importent des types depuis le client Stock | les bounded contexts ne sont pas autonomes |
| `dashboard.component.ts` contient encore 551 lignes | l’extraction du composant n’a pas séparé état, transport et présentation |
| tout est placé dans `src/web/app` | le dépôt est organisé par type technique implicite, pas par parcours métier |

Le problème n’est donc pas le choix d’Angular ou de Signals. C’est l’absence de frontières entre parcours.

## 3. Bounded contexts frontend

### 3.1 Catalogue

Responsabilités :

- rechercher et filtrer le catalogue ;
- consulter le détail d’un Article ;
- créer un Article ;
- modifier son Prix HT et ses attributs autorisés ;
- archiver et réactiver un Article.

Le Catalogue ne réalise aucune opération de stock. La quantité visible dans un détail est une projection reçue de l’API.

### 3.2 Stock

Responsabilités :

- consulter les positions physiques et vendables ;
- enregistrer un Approvisionnement simple ou en masse ;
- enregistrer un Inventaire simple ou en masse ;
- enregistrer un Contre-mouvement ;
- consulter l’Historique global ou celui d’un Article.

L’Historique reste dans ce contexte : il explique les opérations et l’état du Stock. Il ne constitue pas un bounded context autonome.

### 3.3 Ventes

Responsabilités :

- rechercher la projection d’un Article vendable ;
- choisir la quantité et, si nécessaire, le Contexte de Vente ;
- afficher le devis HT, TVA et TTC retourné par l’API ;
- valider une Vente et présenter son résultat figé.

Ventes ne doit pas importer `Catalogue` ou `Stock`. Son endpoint lui fournit un modèle de lecture `SellableArticle` adapté au parcours.

### 3.4 Pilotage

Responsabilités :

- filtrer une période et les dimensions du Dashboard ;
- afficher KPI, stock, flux quotidiens, chiffre d’affaires et TVA ;
- gérer les états vide, chargement et erreur.

Pilotage est strictement en lecture. Il possède ses projections et n’importe aucun modèle interne de Catalogue, Stock ou Ventes.

### 3.5 Shared kernel

Le shared kernel est volontairement fermé. Il peut contenir uniquement les vocabulaires réellement identiques dans plusieurs contextes :

- `ArticleType` ;
- `ConsumptionMode` ;
- `Packaging` ;
- `StockAvailability` ;
- `StockReason`.

Tout nouveau type partagé doit avoir au moins deux consommateurs métier actuels et la même sémantique. Un DTO, un état de formulaire ou un modèle de page n’entre jamais dans le shared kernel.

## 4. Responsabilités des couches

### Domain

- TypeScript pur : aucun import Angular, RxJS, Router, HttpClient, DOM ou stockage navigateur.
- Modèles de lecture métier immuables avec propriétés `readonly`.
- Types du vocabulaire et fonctions de présentation déterministes réellement utiles.
- Aucune duplication des invariants backend : une validation frontend guide la saisie, elle n’autorise jamais une opération métier.

Le frontend n’a pas besoin de classes `ArticleAggregate`, `Money`, `Quantity` ou `SellabilityPolicy`. Les vraies règles existent déjà dans le Domain C#.

### Application

- état d’un parcours avec Signals privés et exposition en lecture seule ;
- commandes déclenchées par l’utilisateur ;
- orchestration des chargements et mutations ;
- transformation d’une erreur technique en état compréhensible par la présentation ;
- contrats de gateway aux seams HTTP réels.

Cette couche peut utiliser Angular Signals, l’injection et RxJS. Elle ne peut pas utiliser `HttpClient`, `Router`, `document`, `window`, `sessionStorage` ou les DTO HTTP.

Un store est créé par parcours, pas un store global par application et pas une classe de use case par clic :

- `CatalogueListStore` ;
- `ArticleCreateStore` ;
- `ArticleDetailsStore` ;
- `StockPositionStore` ;
- `SupplyStore` ;
- `InventoryStore` ;
- `CounterMovementStore` ;
- `HistoryStore` ;
- `SaleStore` ;
- `DashboardStore`.

### Infrastructure

- clients `HttpClient` ;
- DTO de requête et de réponse ;
- mapping DTO vers modèles du contexte ;
- mapping commandes vers payloads ;
- accès à `sessionStorage` limité au parcours Ventes si la restauration de la dernière Vente est conservée ;
- providers qui associent un port à son adapter HTTP.

Un seul gateway cohérent est défini par bounded context. Il est implémenté par l’adapter HTTP en production et par un fake déterministe dans les tests de store. Ce sont des seams réels ; il n’y a pas une interface par endpoint.

### Presentation

- composants standalone ;
- templates, événements, focus et accessibilité ;
- Signal Forms et modèles de formulaire ;
- navigation avec Router ;
- aucun appel HTTP direct ;
- aucune logique de prix, stock ou vendabilité ;
- aucune connaissance d’un DTO `*RequestDto` ou `*ResponseDto`.

Les composants de page injectent leur store. Un composant enfant n’est extrait que s’il représente une interaction autonome ou s’il est réutilisé ; aucun design system local n’est créé pour quelques champs HTML.

## 5. Arborescence cible

```text
src/web/
├── main.ts
├── index.html
├── styles.css                         # reset, variables et styles réellement globaux
├── app/
│   ├── app.ts                         # shell seulement
│   ├── app.html
│   ├── app.css
│   ├── app.config.ts
│   ├── app.routes.ts
│   └── primary-navigation/
│       ├── primary-navigation.ts
│       ├── primary-navigation.html
│       └── primary-navigation.css
├── shared-kernel/
│   ├── article-type.ts
│   ├── consumption-mode.ts
│   ├── packaging.ts
│   ├── stock-availability.ts
│   └── stock-reason.ts
├── shared/
│   ├── application/
│   │   ├── load-state.ts
│   │   └── ui-problem.ts
│   └── http/
│       ├── problem-details.ts
│       └── map-problem-details.ts
├── catalogue/
│   ├── catalogue.routes.ts
│   ├── domain/
│   │   ├── article-summary.ts
│   │   ├── article-details.ts
│   │   ├── article-stock.ts
│   │   ├── article-status.ts
│   │   └── price-quote.ts
│   ├── application/
│   │   ├── catalogue-gateway.ts
│   │   ├── catalogue-gateway.token.ts
│   │   ├── catalogue-list-query.ts
│   │   ├── create-article-command.ts
│   │   ├── update-article-attributes-command.ts
│   │   ├── update-article-price-command.ts
│   │   ├── catalogue-list-state.ts
│   │   ├── catalogue-list.store.ts
│   │   ├── article-create-state.ts
│   │   ├── article-create.store.ts
│   │   ├── article-details-state.ts
│   │   └── article-details.store.ts
│   ├── infrastructure/
│   │   ├── http-catalogue-gateway.ts
│   │   ├── provide-catalogue-gateway.ts
│   │   ├── dto/                       # un fichier par RequestDto ou ResponseDto
│   │   └── mapper/                    # une fonction de mapping exportée par fichier
│   └── presentation/
│       ├── catalogue-page/
│       │   ├── catalogue-page.ts
│       │   ├── catalogue-page.html
│       │   ├── catalogue-page.css
│       │   └── catalogue-page.spec.ts
│       ├── article-create-page/
│       │   ├── article-create-page.ts
│       │   ├── article-create-page.html
│       │   ├── article-create-page.css
│       │   ├── article-create-page.spec.ts
│       │   └── article-create-form-model.ts
│       └── article-details-page/
│           ├── article-details-page.ts
│           ├── article-details-page.html
│           ├── article-details-page.css
│           ├── article-details-page.spec.ts
│           └── article-update-form-model.ts
├── stock/
│   ├── stock.routes.ts
│   ├── domain/
│   │   ├── stock-position.ts
│   │   ├── supply-result.ts
│   │   ├── inventory-result.ts
│   │   ├── counter-movement.ts
│   │   ├── history-entry.ts
│   │   ├── history-line.ts
│   │   └── financial-reversal.ts
│   ├── application/
│   │   ├── stock-gateway.ts
│   │   ├── stock-gateway.token.ts
│   │   ├── record-supply-command.ts
│   │   ├── record-bulk-supply-command.ts
│   │   ├── record-inventory-command.ts
│   │   ├── record-bulk-inventory-command.ts
│   │   ├── record-counter-movement-command.ts
│   │   ├── history-query.ts
│   │   ├── stock-position.store.ts
│   │   ├── supply.store.ts
│   │   ├── inventory.store.ts
│   │   ├── counter-movement.store.ts
│   │   └── history.store.ts
│   ├── infrastructure/
│   │   ├── http-stock-gateway.ts
│   │   ├── provide-stock-gateway.ts
│   │   ├── dto/                       # un fichier par contrat HTTP
│   │   └── mapper/
│   └── presentation/
│       ├── stock-position-page/
│       ├── supply-page/
│       ├── inventory-page/
│       ├── counter-movement-page/
│       └── history-page/              # chaque page : .ts, .html, .css, .spec.ts
├── sales/
│   ├── sales.routes.ts
│   ├── domain/
│   │   ├── sellable-article.ts
│   │   ├── sale-quote.ts
│   │   ├── sale-result.ts
│   │   └── sale-financial-summary.ts
│   ├── application/
│   │   ├── sales-gateway.ts
│   │   ├── sales-gateway.token.ts
│   │   ├── last-sale-storage.ts
│   │   ├── last-sale-storage.token.ts
│   │   ├── sale-command.ts
│   │   ├── sale-state.ts
│   │   └── sale.store.ts
│   ├── infrastructure/
│   │   ├── http-sales-gateway.ts
│   │   ├── provide-sales-gateway.ts
│   │   ├── session-last-sale-storage.ts
│   │   ├── provide-last-sale-storage.ts
│   │   ├── dto/
│   │   └── mapper/
│   └── presentation/
│       └── sale-page/
│           ├── sale-page.ts
│           ├── sale-page.html
│           ├── sale-page.css
│           ├── sale-page.spec.ts
│           └── sale-form-model.ts
└── dashboard/
    ├── dashboard.routes.ts
    ├── domain/
    │   ├── dashboard.ts
    │   ├── dashboard-filter.ts
    │   ├── dashboard-stock-line.ts
    │   ├── dashboard-flow-day.ts
    │   └── dashboard-tax-summary.ts
    ├── application/
    │   ├── dashboard-gateway.ts
    │   ├── dashboard-gateway.token.ts
    │   ├── dashboard-state.ts
    │   └── dashboard.store.ts
    ├── infrastructure/
    │   ├── http-dashboard-gateway.ts
    │   ├── provide-dashboard-gateway.ts
    │   ├── dto/
    │   └── mapper/
    └── presentation/
        └── dashboard-page/
            ├── dashboard-page.ts
            ├── dashboard-page.html
            ├── dashboard-page.css
            └── dashboard-page.spec.ts
```

Les dossiers `dto` et `mapper` ne sont pas des réservoirs de fichiers génériques. Ils contiennent uniquement les contrats et mappings du gateway parent.

## 6. Règles de fichiers et de nommage

### Une déclaration par fichier

La règle cible est stricte pour le code de production :

- une classe exportée par fichier ;
- une interface exportée par fichier ;
- un alias de type exporté par fichier ;
- une énumération exportée par fichier si une énumération est réellement nécessaire ;
- un `InjectionToken` exporté par fichier ;
- une fonction utilitaire exportée par fichier ;
- aucun `models.ts`, `types.ts`, `api.ts`, `helpers.ts` ou `utils.ts` fourre-tout ;
- aucun barrel `index.ts` ou `public-api.ts` au départ ;
- exports nommés, pas d’export par défaut.

Pour les valeurs JSON fermées, préférer un alias d’union de chaînes à un `enum` TypeScript :

```ts
export type StockAvailability = 'AVAILABLE' | 'OUT_OF_STOCK' | 'NOT_SELLABLE';
```

Le composant suit le nommage Angular actuel, sans suffixe historique `.component` :

```text
dashboard-page.ts
dashboard-page.html
dashboard-page.css
dashboard-page.spec.ts
```

### Imports

- `import type` pour toute dépendance uniquement utilisée par le système de types ;
- aucun import d’un bounded context vers un autre ;
- imports relatifs explicites au départ ;
- pas d’alias de chemins tant que la profondeur réelle ne les justifie pas ;
- aucun cycle ;
- les DTO ne sortent jamais de `infrastructure`.

## 7. Routage et composition

Le shell racine contient seulement la navigation, le titre global et un `router-outlet`.

Routes cibles :

| URL | Capacité |
| --- | --- |
| `/dashboard` | Pilotage |
| `/catalogue` | recherche et liste des Articles |
| `/catalogue/nouveau` | création d’un Article |
| `/catalogue/:ean13` | détail et cycle de vie |
| `/stock` | positions courantes |
| `/stock/approvisionnements` | Approvisionnements |
| `/stock/inventaires` | Inventaires |
| `/stock/corrections` | Contre-mouvements |
| `/stock/historique` | Historique global ou filtré |
| `/ventes` | Vente simulée |

Chaque groupe est chargé paresseusement avec `loadChildren`, et chaque page avec `loadComponent` lorsque le groupe ne contient qu’une route. Les stores et gateways sont fournis au niveau de la route afin que leur état soit détruit avec le parcours.

```ts
export const APP_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'dashboard', loadChildren: () => import('../dashboard/dashboard.routes').then((m) => m.DASHBOARD_ROUTES) },
  { path: 'catalogue', loadChildren: () => import('../catalogue/catalogue.routes').then((m) => m.CATALOGUE_ROUTES) },
  { path: 'stock', loadChildren: () => import('../stock/stock.routes').then((m) => m.STOCK_ROUTES) },
  { path: 'ventes', loadChildren: () => import('../sales/sales.routes').then((m) => m.SALES_ROUTES) },
  { path: '**', redirectTo: 'dashboard' },
];
```

## 8. Modèle d’état

Les stores exposent des Signals en lecture seule. Les composants n’écrivent pas directement dans l’état applicatif.

Un état de lecture est une union discriminée, pas quatre booléens indépendants :

```ts
export type LoadState<T> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly previous?: T }
  | { readonly kind: 'ready'; readonly data: T }
  | { readonly kind: 'empty' }
  | { readonly kind: 'error'; readonly problem: UiProblem; readonly previous?: T };
```

Règles :

- Signals privés mutables, `asReadonly()` en sortie ;
- `computed()` pour les données dérivées ;
- `effect()` uniquement pour synchroniser un système externe, jamais pour propager un état calculable ;
- `switchMap` pour les lectures dépendantes de filtres afin d’annuler une réponse obsolète ;
- commandes de mutation sérialisées ou protégées contre le double envoi ;
- destruction des subscriptions avec `takeUntilDestroyed()` ;
- focus et annonce ARIA dans la présentation, pas dans le store ;
- stockage navigateur derrière un adapter, pas lu directement dans un composant.

La bibliothèque d’état native suffit. NgRx ne devient pertinent que si plusieurs routes modifient simultanément un même état client durable avec journalisation ou effets transverses complexes, ce qui n’est pas le cas actuel.

## 9. Contrats HTTP et mapping

Chaque contexte expose un port étroit. Exemple pour Catalogue :

```ts
export interface CatalogueGateway {
  search(query: CatalogueListQuery): Observable<readonly ArticleSummary[]>;
  get(ean13: string): Observable<ArticleDetails>;
  create(command: CreateArticleCommand): Observable<ArticleDetails>;
  updateAttributes(command: UpdateArticleAttributesCommand): Observable<ArticleDetails>;
  updatePrice(command: UpdateArticlePriceCommand): Observable<ArticleDetails>;
  archive(ean13: string): Observable<ArticleDetails>;
  reactivate(ean13: string): Observable<ArticleDetails>;
}
```

Le token d’injection, l’interface et l’implémentation restent dans trois fichiers :

```text
application/catalogue-gateway.ts
application/catalogue-gateway.token.ts
infrastructure/http-catalogue-gateway.ts
```

Les mappings sont obligatoires au seam HTTP :

```text
ArticleResponseDto ──map──► ArticleDetails
CreateArticleCommand ──map──► CreateArticleRequestDto
ProblemDetails ──map──► UiProblem
```

Les noms `RequestDto` et `ResponseDto` n’existent que dans `infrastructure/dto`. Les modèles `ArticleDetails`, `StockPosition`, `SaleResult` ou `Dashboard` ne portent pas le suffixe du transport.

## 10. Angular 2026

### Composants et templates

- standalone par défaut, aucun `NgModule` ;
- `ChangeDetectionStrategy.OnPush` explicite ;
- `inject()` plutôt que l’injection par constructeur ;
- API d’inputs/outputs basées sur Signals pour les nouveaux composants ;
- template et styles dans des fichiers séparés portant le même nom que le composant ;
- contrôle de flux natif `@if`, `@for` et `@switch` ;
- `track` obligatoire et fondé sur une identité stable dans `@for` ;
- propriétés `protected` lorsqu’elles sont destinées uniquement au template ;
- logique simple dans le template ; les dérivations vont dans `computed()` ;
- bindings natifs de classes et styles plutôt que des abstractions inutiles ;
- conservation des labels, messages d’erreur, états de chargement, annonces et focus clavier existants.

### Formulaires

- Signal Forms pour les formulaires métier déjà concernés ;
- un modèle de formulaire propre à chaque parcours dans `presentation` ;
- validations ergonomiques locales, puis mapping vers une commande immuable ;
- erreurs serveur mappées vers le champ grâce à un code stable ;
- aucune confiance accordée à la validation navigateur pour les invariants métier ;
- tests du lien DOM ↔ modèle et des erreurs après stabilisation de TestBed.

### TypeScript 6

Le projet utilise `6.0.0-beta`, alors que les packages Angular installés acceptent `>=6.0 <6.1`. La cible est une version stable compatible de TypeScript 6, actuellement `6.0.2`, puis l’activation de :

```json
{
  "compilerOptions": {
    "strict": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noUncheckedSideEffectImports": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

Le test en lecture seule de ces options sur le code actuel remonte 62 erreurs : 50 imports à convertir en `import type`, puis principalement des accès de tableau potentiellement absents et des propriétés optionnelles ambiguës. Le durcissement est donc réaliste, mais doit être appliqué tranche par tranche pendant l’extraction plutôt qu’en un changement massif.

Conventions complémentaires :

- pas de `any` ; `unknown` à toute frontière non maîtrisée ;
- objets et tableaux métier en `readonly` ;
- union discriminée plutôt que combinaison de booléens ;
- `satisfies` pour vérifier une configuration sans élargir ses types ;
- pas d’assertion non-null `!` sans preuve portée par l’API appelée ;
- cents transportés comme nombres entiers ; formatage avec les pipes Angular ou `Intl`, jamais avec des calculs flottants métier.

## 11. Stratégie de tests

| Niveau | Cible | Doubles et outil |
| --- | --- | --- |
| Domain frontend | fonctions pures et modèles dérivés seulement | Vitest, sans TestBed |
| Application | transitions d’état, concurrence, erreurs et commandes | fake du gateway du contexte |
| Infrastructure | URL, paramètres, payloads et mapping des DTO | `HttpTestingController` |
| Presentation | DOM, Signal Forms, focus et accessibilité | TestBed/Vitest |
| Parcours | comportement observable de bout en bout | Playwright |
| Architecture | directions d’import et règle de déclaration | `node:test` existant |

Le test `tests/architecture.test.mjs` doit être étendu sans nouveau package pour garantir :

1. aucun import Angular/RxJS/HTTP dans `*/domain` ;
2. aucun `HttpClient` dans `*/application` ou `*/presentation` ;
3. aucun import direct entre `catalogue`, `stock`, `sales` et `dashboard` ;
4. aucun import d’un dossier `infrastructure/dto` hors de son infrastructure ;
5. une seule déclaration top-level exportée par fichier de production ;
6. absence de fichiers fourre-tout et de barrels ;
7. absence de NgRx, Mediator, generic store ou generic repository.

Les tests existants doivent être déplacés par comportement, pas copiés. Un test reste au niveau le plus bas capable de prouver le résultat.

## 12. Migration incrémentale

Le refactoring ne doit pas être un big bang.

### Étape 1 — Shell et Router

- créer `app.ts`, `app.html`, `app.css`, `app.config.ts` et `app.routes.ts` ;
- déplacer uniquement navigation et `router-outlet` dans le shell ;
- conserver les contrats API et comportements existants ;
- ajouter les URLs cibles et les redirects nécessaires.

Validation : build, tests web et smoke E2E.

### Étape 2 — Pilotage

- convertir le Dashboard déjà séparé en première tranche verticale ;
- créer son modèle de lecture, son store, son gateway HTTP et sa route paresseuse ;
- déplacer ses styles et tests ;
- supprimer ses dépendances à Stock.

Cette tranche sert de modèle, car elle est en lecture seule et déjà partiellement isolée.

### Étape 3 — Catalogue

- extraire liste, création et détail par route ;
- déplacer chaque contrat HTTP dans son propre fichier DTO ;
- introduire `CatalogueGateway` et les trois stores de parcours ;
- mapper les DTO vers les modèles Catalogue ;
- supprimer les Signals Catalogue du composant historique.

### Étape 4 — Stock, une opération à la fois

Ordre recommandé : positions, Approvisionnements, Inventaires, Contre-mouvements, Historique.

Chaque sous-étape livre sa page, son store, ses DTO, ses mappings et ses tests avant la suivante. Un seul `StockGateway` est partagé par ces parcours.

### Étape 5 — Ventes

- créer la projection `SellableArticle` propre à Ventes ;
- déplacer devis, validation, résultat et restauration de session ;
- faire dépendre `SaleStore` uniquement de `SalesGateway` et du stockage de dernière Vente ;
- conserver les montants retournés par le serveur sans les recalculer.

### Étape 6 — Durcissement et suppression

- supprimer `app.component.ts`, `app.component.spec.ts` et les anciens `*-api.service.ts` lorsqu’ils n’ont plus de consommateurs ;
- stabiliser TypeScript 6 et activer les options strictes ;
- étendre le test d’architecture frontend ;
- répartir `styles.css` entre shell, pages et styles globaux ;
- lancer la chaîne complète `npm run verify`.

À chaque étape, le code ancien du parcours extrait est supprimé. Aucune couche de compatibilité durable ne doit être empilée sur le composant racine.

## 13. Critères d’acceptation de l’architecture

La migration est terminée lorsque :

- `App` n’injecte aucun client HTTP et ne connaît aucun état métier ;
- chaque URL peut être chargée et testée indépendamment ;
- aucun composant n’utilise un DTO HTTP ;
- aucun bounded context n’importe un autre bounded context ;
- chaque parcours possède un store route-scoped et un seul propriétaire de son état ;
- les réponses obsolètes sont annulées ou ignorées dans le store concerné ;
- les invariants métier restent autoritaires dans le backend ;
- chaque déclaration exportée possède son fichier ;
- les tests d’architecture rendent les règles de dépendance exécutables ;
- les 40 comportements unitaires et les 35 parcours E2E actuels sont conservés ou remplacés par une preuve équivalente ;
- build Angular, tests web, tests d’architecture, tests .NET et E2E passent ensemble.

## 14. Éléments volontairement absents

- NgRx ou autre store global ;
- façade générique, `BaseStore`, `BaseApiService` ou `GenericGateway<T>` ;
- classe de use case par bouton ;
- duplication frontend des aggregates et policies backend ;
- client OpenAPI généré tant que le volume et la fréquence de changement du contrat ne le justifient pas ;
- bibliothèque de composants interne avant l’existence de composants réellement répétés ;
- aliases de chemins et barrels ajoutés uniquement pour raccourcir les imports ;
- microfrontends, packages par contexte ou monorepo Nx ;
- limite arbitraire de lignes par fichier.

Le bon indicateur n’est pas le nombre de dossiers. C’est la possibilité de modifier un parcours sans charger mentalement tous les autres.

## 15. Sources techniques

- [Angular — Style Guide](https://angular.dev/style-guide)
- [Angular — Signals](https://angular.dev/guide/signals)
- [Angular — Lazy-loaded routes](https://angular.dev/best-practices/performance/lazy-loaded-routes)
- [Angular — Testing Signal Forms](https://angular.dev/guide/forms/signals/testing)
- [TypeScript 6](https://github.com/microsoft/TypeScript)
- [`CONTEXT.md`](../CONTEXT.md)
- [`ARCHITECTURE.md`](../ARCHITECTURE.md)
