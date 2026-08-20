# Token Warehouse

Socle exécutable et testable du monolithe modulaire. Cette livraison ne contient
aucun comportement Catalogue, Stock, Vente ou Pilotage.

## Stack et structure

- .NET SDK `10.0.400`, ASP.NET Core 10 Minimal API et EF Core 10.
- Angular `22.1.3` standalone avec le builder Angular `22.1.5`.
- SQLite local dans `token-warehouse.db`; les tests d'intégration utilisent un
  fichier temporaire et une connexion SQLite `:memory:` conservée ouverte.
- Le test Playwright utilise `artifacts/playwright/token-warehouse-playwright.db`,
  un fichier éphémère supprimé avec les artefacts.
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

`dotnet test` couvre Domain, Application, la composition du host HTTP, la
substitution du fake et les migrations SQLite. `npm run test:web` exécute le
test Angular Vitest du shell. Le test Playwright ouvre le shell Angular réel,
interroge le `/health` technique de l'API réelle et sauvegarde une capture dans
`artifacts/playwright/shell.png`; aucun mock réseau ou endpoint métier n'est
utilisé.

La commande `npm run verify` a été exécutée deux fois le 19 août 2026 : une
fois après l'installation initiale, puis après `dotnet clean TokenWarehouse.slnx`
et `npm ci --legacy-peer-deps`. Les deux exécutions ont terminé avec le code 0,
sans service externe ni fichier `.env`.

## Lancement manuel et nettoyage

```sh
dotnet run --project src/backend/TokenWarehouse.Api/TokenWarehouse.Api.csproj --urls http://127.0.0.1:5100
npm run start:web
```

L'API expose uniquement `GET /health` pour le probe technique. Le host applique
les migrations SQLite au démarrage sans service externe ni secret.

Pour repartir d'un état local propre:

```sh
dotnet clean TokenWarehouse.slnx
rm -rf dist artifacts token-warehouse.db token-warehouse.db-shm token-warehouse.db-wal
```
