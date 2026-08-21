# Token Warehouse

Socle exécutable et testable du monolithe modulaire, avec le parcours de création
et de consultation d’un Article.

## Stack et structure

- .NET SDK `10.0.400`, ASP.NET Core 10 Minimal API et EF Core 10.
- Angular `22.1.3` standalone avec Signals/Signal Forms et le builder Angular `22.1.5`.
- SQLite local dans `src/backend/TokenWarehouse.Api/token-warehouse.db` pour le
  lancement manuel; les tests d'intégration utilisent un fichier temporaire et
  une connexion SQLite `:memory:` conservée ouverte.
- Le test Playwright utilise une base temporaire sous `artifacts/playwright/`,
  créée et passée à l’API par un chemin absolu à chaque exécution.
- Playwright `1.62.1` lance l'API et Angular lui-même sur `5100` et `4200`.

Les dépendances vont de `Domain` vers `Application`, puis vers
`Infrastructure`; `Api` compose les adapters. Aucun generic repository,
Mediator, CQRS ou bus d'événements n'est présent.

## Prérequis et premier lancement

Depuis la racine, dans un checkout propre:

```sh
dotnet --version
node --version
npm --version
dotnet tool restore
npm ci --legacy-peer-deps
npx playwright install chromium
```

Le checkout de référence utilise .NET `10.0.400` et Node `>=24.15.0`.
`--legacy-peer-deps` est requis par le lockfile Angular 22, qui utilise le
pré-release TypeScript 6 demandé par Angular 22.

## Vérification déterministe

```sh
dotnet build TokenWarehouse.slnx
dotnet test TokenWarehouse.slnx --no-build
npm run build:web
npm run test:web
npm run test:architecture
npm run test:e2e
```

Ou, après `dotnet tool restore` et `npm ci --legacy-peer-deps`:

```sh
npm run verify
```

`dotnet test` couvre le Domain, l’Application, la composition du host HTTP,
SQLite, les collisions EAN et la substitution du fake. `npm run test:web`
exécute les tests publics du formulaire Angular. Le test Playwright crée puis
relit des Articles alimentaires et non alimentaires dans l’interface réelle,
avec erreurs et clavier; le scénario de panne intercepte uniquement la requête
publique du Catalogue pour rendre l’erreur et le retry déterministes.

La commande `npm run verify` a été exécutée deux fois le 19 août 2026 : une
fois après l'installation initiale, puis après `dotnet clean TokenWarehouse.slnx`
et `npm ci --legacy-peer-deps`. Les deux exécutions ont terminé avec le code 0,
sans service externe ni fichier `.env`.

## Lancement manuel et nettoyage

```sh
dotnet run --project src/backend/TokenWarehouse.Api/TokenWarehouse.Api.csproj --urls http://127.0.0.1:5100
npm run start:web
```

L’API expose `GET /health`, `GET /api/articles`, `POST /api/articles`,
`GET /api/articles/{ean13}`, `PATCH /api/articles/{ean13}`,
`POST /api/articles/{ean13}/archive`, `POST /api/articles/{ean13}/reactivate`
et `GET /api/history?ean13={ean13}`. Elle expose aussi
`POST /api/supplies` pour enregistrer une réception unitaire. Le payload
conserve `ean13` comme chaîne et exige une `quantity` entière strictement
positive; le succès `201` retourne l’`operation` immuable (`id`, `type`,
`ean13`, `quantity`, `occurredAt`) et la `position` engagée. Les erreurs sont
des Problem Details: `400` pour la structure ou la quantité, `404` pour un
Article inconnu et `409` avec `code: article_archived` pour un Article archivé.
Le PATCH accepte `priceHtCents` pour le
parcours de prix existant, ou les attributs évolutifs `name`, `dlc` et
`consumptionModes` pour un Article alimentaire, et `name` et `packaging` pour
un Article non alimentaire. Un PATCH qui mélange prix et attributs est refusé;
une modification d’attributs renvoie la représentation canonique après commit
et ajoute un fait immuable à l’Historique.
Le host applique les migrations SQLite au démarrage sans service externe ni
secret.

## Contrat Stock courant

`GET /api/stock` retourne une ligne ordonnée par EAN-13 pour chaque Article du
Catalogue, y compris les Articles archivés et ceux sans position courante.
`GET /api/stock/{ean13}` retourne la même représentation pour un Article connu.
Chaque ligne conserve l’EAN-13 comme chaîne et expose `physicalQuantity`,
`sellableQuantity`, `availability` (`AVAILABLE`, `OUT_OF_STOCK` ou
`NOT_SELLABLE`) et `reason` (`ARCHIVED`, `DLC_EXPIRED`,
`UNSELLABLE_PACKAGING` ou `null`). Les quantités vendables sont calculées par
le backend et ne sont jamais recalculées par Angular. Un EAN mal formé renvoie
`400`, un Article inconnu `404`, et les erreurs techniques utilisent
`application/problem+json` avec `code: internal_error`.

## Contrat Article

Les valeurs canoniques du JSON sont `food`/`nonFood`, `takeaway`/`onsite` et
`new`/`refurbished`/`unsellable`. Une création valide transporte `ean13` comme
chaîne de 13 chiffres, `priceHtCents` comme entier et renvoie `isActive: true`
avec `status: "active"`. Les transitions renvoient le même contrat avec
`status: "archived"` ou `status: "active"` et ajoutent un fait immuable
consultable par l’Historique.
Les réponses alimentaires exposent `dlc` et `consumptionModes`; les réponses
non alimentaires exposent `packaging`, sans attribut de l’autre classification.
Chaque réponse Article expose aussi `priceQuotes`: une quote pour un mode unique
ou un Article non alimentaire, deux quotes pour les deux modes. Une quote porte
`saleContext` si applicable, `taxRate` (`code`, `ratio`, `numerator`,
`denominator`), `vatCents` et `priceTtcCents`. Les Prix TTC ne sont pas persistés.

La liste accepte `status=active|archived|all` (actif par défaut), `search` pour
le nom ou l’EAN-13, `type=food|nonFood`, `mode=takeaway|onsite` et
`packaging=new|refurbished|unsellable`. Les dimensions présentes sont combinées
par intersection; une collection vide reste une réponse `200 []`.

Les erreurs sont `application/problem+json`: `400` avec `code: article.validation`
et `errors` indexées par champ, `409` avec `code: article.ean13.conflict`, `404`
avec `code: article.not_found` et `500` avec `code: internal_error` sans détail
interne.

Pour repartir d'un état local propre:

```sh
dotnet clean TokenWarehouse.slnx
rm -rf dist artifacts
rm -f token-warehouse.db token-warehouse.db-shm token-warehouse.db-wal \
  src/backend/TokenWarehouse.Api/token-warehouse.db \
  src/backend/TokenWarehouse.Api/token-warehouse.db-shm \
  src/backend/TokenWarehouse.Api/token-warehouse.db-wal
```
