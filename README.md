# Token Warehouse

Back-office de gestion de stocks pour un entrepôt unique, réalisé en réponse à
l'exercice technique « Gestion de stocks ».

Angular 22 (standalone, Signals, Signal Forms) devant une API ASP.NET Core 10
Minimal API en C#, sur SQLite via EF Core 10. Découpage hexagonal
Domain / Application / Infrastructure / Presentation, vérifié par un test
d'architecture.

---

## 1. Réponses aux questions du brief

### IA utilisée

- **Claude Code (Opus)** — agent principal, exécution des loops de spécification
  et de delivery.
- **ChatGPT (GPT)** — en second, pour la mise au point du workflow et des
  arbitrages ponctuels de conception.

### Usages de l'IA

L'IA n'a pas été utilisée en « autocomplétion assistée ». Le temps humain a été
investi dans la **conception d'un workflow agentique** qui produit, relit et
valide le code de bout en bout ; le pilotage de ce workflow a ensuite remplacé
l'écriture directe.

Le workflow est branché sur GitHub Issues et GitHub Projects, et s'exécute en
huit loops :

| Phase | Loop | Rôle |
| --- | --- | --- |
| Spécification | `po` | Raffine le besoin métier en issue lisible et testable. |
| Spécification | `tech-spec` | Raffine la solution technique, les seams et l'impact architecture. |
| Spécification | `qa-spec` | Transforme l'issue en contrat QA falsifiable avant tout code. |
| Delivery | `developer` | Implémente le ticket, en TDD, sur une branche dédiée. |
| Delivery | `reviewer` | Revue technique indépendante de la PR. |
| Delivery | `qa` | Validation QA au SHA exact, checks déterministes + exploration Playwright. |
| Delivery | `rework` | Reprend les rejets de review ou de QA. |
| Delivery | `merge` | Merge après review et QA vertes. |

Chaque tranche fonctionnelle a donc traversé un refine besoin → refine technique
→ refine qualité → développement → review → QA → merge : 56 commits sur `main`,
dont 45 merges de PR, une PR par tranche verticale.

Ce qui est resté à la main, et qui explique les choix visibles dans le code :
la **modélisation du domaine** (agrégats, value objects, politiques), les
**arbitrages métier** (archivage plutôt que suppression, contre-mouvement plutôt
qu'édition d'historique, taux de TVA rationnels plutôt que décimaux), le
**périmètre**, et l'**acceptation ou le rejet** de chaque PR.

### Temps passé

**Une dizaine d'heures de temps humain**, réparties sur 8 jours calendaires
(18 → 25 août 2026). L'essentiel de ces heures est allé à la construction du
workflow, à la spécification et à la revue — pas à la frappe de code.

C'est l'hypothèse de travail assumée de ce rendu : à qualité égale, le levier
d'un Lead Tech n'est pas sa vitesse de frappe, c'est le système qu'il met en
place pour que le travail sorte relu, testé et traçable sans lui.

### Choix et hypothèses

**Interprétations de l'énoncé**

- **« Suppression » d'un Article → archivage réversible.** Un Article référencé
  par des mouvements de stock ne peut pas disparaître sans casser l'Historique
  et les Ventes déjà enregistrées. `POST /api/articles/{ean13}/archive` et
  `/reactivate` remplacent le `DELETE`. L'archivage rend l'Article non vendable
  et bloque l'approvisionnement, sans effacer son passé.
- **Une correction ne modifie jamais un fait passé.** Une erreur de saisie se
  corrige par un **Contre-mouvement** explicite et justifié, qui annule l'effet
  du mouvement source et le référence. Lecture comptable du besoin exprimé par
  l'énoncé (« articles perdus ou volés », « erreurs de saisie de stock »).
- **Le Stock physique est une position courante, pas un recalcul.** L'énoncé
  définit la quantité en stock comme « la somme des approvisionnements depuis le
  dernier inventaire, moins les quantités vendues ». Le système tient une
  position courante mutée dans la même transaction que chaque fait, et un
  Inventaire pose une nouvelle base physique. Résultat identique, lecture O(1)
  au lieu d'un repli sur tout l'historique.
- **Stock physique ≠ Stock vendable.** Un Article périmé, archivé ou au
  packaging invendable conserve son Stock physique mais tombe à zéro vendable,
  avec la raison exposée par l'API.
- **Les prix TTC ne sont jamais persistés.** Ils sont recalculés à partir du
  Prix HT et du taux applicable. Seule une Vente fige son snapshot financier,
  qui reste immuable ensuite.
- **Les montants sont en centimes entiers, les taux de TVA en rationnels.**
  `TaxRate("takeaway", 11, 200)` plutôt que `0.055m`. Aucun flottant sur un
  chemin financier, arrondi au centime explicite et testé aux bornes. Le
  Gestionnaire, lui, ne voit et ne saisit que des euros : la conversion vit à
  la frontière de présentation, et la saisie accepte la virgule comme le point.
- **Un seul Entrepôt, un seul Gestionnaire, pas d'authentification.** Hors
  périmètre de l'exercice.

**Choix techniques**

- **Monolithe modulaire, pas de microservices.** Quatre projets, dépendances à
  sens unique, composition dans la Presentation.
- **Pas de Mediator, pas de CQRS, pas de bus d'événements, pas de generic
  repository.** Des classes de use case explicites suffisent à cette taille. Un
  test d'architecture échoue si l'un de ces éléments réapparaît.
- **SQLite en fichier local.** Aucun service externe, aucun secret, aucune
  installation ; les migrations s'appliquent au démarrage.
- **Angular 22 avec Signal Forms.** Choisi pour la validation typée des
  formulaires de saisie. Voir la réserve en §6.
- **Aucune librairie de composants UI.** Le CSS est écrit à la main, l'interface
  reste sobre et pilotable au clavier.

**Périmètre**

L'énoncé précise « il n'est pas obligatoire de tout faire ». Toutes les
fonctionnalités listées en exemple sont couvertes, et trois modules ont été
ajoutés au-delà : **Ventes** (nécessaires pour que « moins les quantités
vendues » ait un sens), **Contre-mouvements**, et un **Dashboard** de pilotage
avec indicateurs financiers.

Assumé : c'est un dépassement de périmètre. Il est le produit du débit du
workflow agentique, pas d'un arbitrage produit. Voir §6 pour ce que je
retrancherais.

---

## 2. Lancer le projet

### Prérequis

- .NET SDK `10.0.400`
- Node.js `>= 24.15.0`

### Installation

```sh
dotnet tool restore
npm ci --legacy-peer-deps
npx playwright install chromium
```

`--legacy-peer-deps` est requis par le lockfile Angular 22, qui utilise
TypeScript `6.0.3`, version stable compatible avec Angular 22.

### Lancement manuel

```sh
# Terminal 1 — API sur http://127.0.0.1:5100
dotnet run --project src/backend/TokenWarehouse.Api/TokenWarehouse.Api.csproj --urls http://127.0.0.1:5100

# Terminal 2 — front sur http://127.0.0.1:4200
npm run start:web
```

Le front proxifie `/api` vers l'API. La base SQLite est créée et migrée au
démarrage dans `src/backend/TokenWarehouse.Api/token-warehouse.db`.

**Jeu de démonstration.** Si le Catalogue est vide au démarrage, l'API le
peuple : 20 Articles, un Approvisionnement, six Ventes couvrant les trois taux
de TVA, un Inventaire avec écart et un Contre-mouvement. L'application ne
s'ouvre donc jamais sur des écrans vides. Le peuplement passe par les use cases,
jamais par des écritures directes en base, et il est ignoré dès qu'un Article
existe ou que l'environnement est `Testing`. Les données suivent
[le brief créatif](docs/token-warehouse-creative-product-brief.md) : les
Articles alimentaires sont des modèles de langage — à emporter pour les poids
ouverts, sur place pour les modèles consommés via API — et les non alimentaires
une gamme de compute du Gaming PC au Space Datacenter. Le jeu contient
volontairement quatre Articles bloqués — un archivé, une DLC dépassée, deux
Packagings invendables — pour que les trois raisons de non-vendabilité soient
visibles dès l'ouverture. Parcours de test manuel :
[`docs/GUIDE_TEST_MANUEL.md`](docs/GUIDE_TEST_MANUEL.md).

### Vérification complète

```sh
npm run verify
```

Enchaîne, dans cet ordre :

```sh
npm run build:web          # build Angular de production
npm run test:web           # tests unitaires front (Vitest)
npm run test:architecture  # tests d'architecture (node:test)
dotnet build TokenWarehouse.slnx
dotnet test TokenWarehouse.slnx --no-build
npm run test:e2e           # Playwright, API réelle
```

**Dernière exécution complète mesurée — 25 août 2026, commit `62dcfe9` (HEAD de
`main`) :**

| Suite | Résultat |
| --- | --- |
| `dotnet build` | 8 projets, 0 erreur, 0 warning (`TreatWarningsAsErrors`) |
| `dotnet test` | 315 tests — Domain 65, Application 79, Api 171 |
| `test:architecture` | 18 tests |
| `build:web` | 267,08 kB initial / 75,17 kB transféré, 32 lazy chunks |
| `test:web` | 40 fichiers, 122 tests |
| `test:e2e` | 105 tests (5 min 42) |
| **Total** | **560 tests, 0 échec** |

### Repartir d'un état propre

```sh
dotnet clean TokenWarehouse.slnx
rm -rf dist artifacts
rm -f src/backend/TokenWarehouse.Api/token-warehouse.db \
  src/backend/TokenWarehouse.Api/token-warehouse.db-shm \
  src/backend/TokenWarehouse.Api/token-warehouse.db-wal
```

---

## 3. Architecture

```text
Angular  ──HTTP JSON──▶  Api (Presentation)
                              │ compose les adapters
                              ▼
                        Application  ── définit les ports
                              ▼
                          Domain  ── invariants, aucun framework
                              ▲
                        Infrastructure  ── EF Core, SQLite, horloge
```

| Projet | Contenu | Dépendances |
| --- | --- | --- |
| `TokenWarehouse.Domain` | Agrégats, value objects, politiques | **aucune** |
| `TokenWarehouse.Application` | Use cases, ports | Domain |
| `TokenWarehouse.Infrastructure` | Adapters EF Core / SQLite, horloge | Application |
| `TokenWarehouse.Api` | Endpoints HTTP, composition | Application + Infrastructure |

`npm run test:architecture` échoue si ce sens de dépendance change, si un paquet
de framework remonte dans le Domain ou l'Application, ou si un Mediator, un
generic repository, du CQRS ou un event bus apparaît.

**Building blocks du Domain**

- Agrégats : `Article`, `StockPosition`
- Entité immuable : `StockOperation` (Approvisionnement, Vente, Inventaire,
  Contre-mouvement)
- Value objects : `Ean13` (13 chiffres + checksum), `Money` (centimes),
  `Quantity`, `TaxRate` (rationnel), `SaleContext`, `Justification`
- Politiques : `PricingPolicy` (taux applicable, TVA, arrondi),
  `SellabilityPolicy` (Stock vendable, raison de blocage)

Détail complet et justification de chaque choix : [`ARCHITECTURE.md`](ARCHITECTURE.md).
Vocabulaire métier : [`CONTEXT.md`](CONTEXT.md). Décisions datées :
[ADR](docs/adr/).

---

## 4. Règles métier implémentées

| Règle | Implémentation |
| --- | --- |
| EAN-13 unique, 13 chiffres, checksum valide | `Ean13.TryCreate` + contrainte d'unicité en base ; une collision concurrente renvoie `409`, pas une exception |
| Deux classifications d'Articles | Attributs exclusifs : une DLC et des modes de consommation pour l'alimentaire, un Packaging pour le non alimentaire |
| TVA 5,5 % à emporter | `TaxRate(11, 200)` |
| TVA 10 % sur place | `TaxRate(1, 10)` |
| TVA 20 % non alimentaire | `TaxRate(1, 5)` |
| Article aux deux modes | Deux quotes de prix, une par contexte ; une Vente exige alors un contexte explicite |
| Stock = approvisionnements depuis le dernier inventaire − ventes | Position courante mutée par chaque fait ; un Inventaire pose une nouvelle base physique |
| Écarts d'inventaire (pertes, vols, erreurs) | `InventoryReconciliation` calcule et conserve l'écart, il n'est jamais silencieux |
| Stock vendable | Zéro si archivé, DLC dépassée ou Packaging invendable, avec la raison |
| Opérations en masse | Toutes les lignes validées avant une transaction unique ; une ligne fautive rejette la livraison entière |
| Concurrence | Verrouillage optimiste par version sur l'Article et sur la position ; une position ne peut pas devenir négative |

---

## 5. Contrat HTTP

Toutes les erreurs structurées sont en `application/problem+json`, avec un
champ `code` et, pour les validations, des `errors` indexées par champ
exploitables directement par Signal Forms.

### Catalogue

| Méthode | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/articles` | Filtres `status` (`active` par défaut, `archived`, `all`), `search` (nom ou EAN-13), `type`, `mode`, `packaging`. Combinés par intersection. Chaque ligne expose aussi `priceQuotes`, de même forme que le détail. |
| `POST` | `/api/articles` | `ean13` en chaîne, `priceHtCents` entier. `409 article.ean13.conflict` sur doublon. |
| `GET` | `/api/articles/{ean13}` | Expose `priceQuotes` : une quote par contexte applicable, avec `taxRate`, `vatCents`, `priceTtcCents`. |
| `PATCH` | `/api/articles/{ean13}` | Soit `priceHtCents`, soit les attributs (`name`, `dlc`, `consumptionModes`, `packaging`). Mélanger les deux est refusé. |
| `POST` | `/api/articles/{ean13}/archive` | |
| `POST` | `/api/articles/{ean13}/reactivate` | |

### Stock et opérations

| Méthode | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/stock` | Une ligne par Article, archivés et sans position inclus. `physicalQuantity`, `sellableQuantity`, `availability`, `reason`. |
| `GET` | `/api/stock/{ean13}` | |
| `POST` | `/api/supplies` | Réception unitaire. `409 article_archived` sur Article archivé. |
| `POST` | `/api/supplies/bulk` | `lines` non vide. Erreurs conservées sous `lines[1].quantity`. Priorité `400` → `409` → `404`. |
| `GET` | `/api/supplies/{id}` | |
| `POST` | `/api/inventories` | `ean13` + `countedQuantity`. Renvoie l'écart, la nouvelle base physique et le Stock vendable. |
| `POST` | `/api/inventories/bulk` | Un seul Article par ligne. |
| `GET` | `/api/inventories/{id}` | Relit le fait sans modifier la position. |
| `GET` | `/api/stock/counter-movements/sources` | Opérations corrigeables. |
| `POST` | `/api/stock/counter-movements` | Justification obligatoire ; annule l'effet du mouvement source. |

### Ventes, Historique, Pilotage

| Méthode | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/sales/articles` | Articles vendables, avec leur Stock vendable. |
| `POST` | `/api/sales` | Contexte de vente exigé si l'Article a deux modes. Fige un snapshot financier immuable. |
| `GET` | `/api/sales/{operationId}` | |
| `GET` | `/api/history` | `?ean13=` optionnel. Fusionne mouvements de stock et faits de cycle de vie, du plus récent au plus ancien. |
| `GET` | `/api/dashboard` | Période, filtres, flux quotidiens, indicateurs financiers par taux de TVA. |
| `GET` | `/health` | État de la persistance et calendrier de l'Entrepôt. |

**Valeurs canoniques du JSON** : `food` / `nonFood`, `takeaway` / `onsite`,
`new` / `refurbished` / `unsellable`, `AVAILABLE` / `OUT_OF_STOCK` /
`NOT_SELLABLE`, `ARCHIVED` / `DLC_EXPIRED` / `UNSELLABLE_PACKAGING`.

**Déterminisme des tests** : `TOKEN_WAREHOUSE_UTC_NOW` fige l'instant UTC des
opérations, `TOKEN_WAREHOUSE_WAREHOUSE_DATE` la date métier de l'Entrepôt.

---

## 6. Limites connues et dette assumée

Ce que je retrancherais ou corrigerais en priorité si ce projet passait en
production, par ordre d'importance :

1. **Aucune CI.** `npm run verify` existe et passe ; rien ne l'exécute
   automatiquement. C'est le premier manque à combler.
2. **Périmètre trop large pour l'exercice.** Ventes, Dashboard et
   Contre-mouvements sont hors demande. Le rendu aurait été plus lisible sans
   eux.
3. **Stratégie de réutilisation de route encore portée par le routeur.**
   `app/route-reuse-strategy.ts` conserve des composants détachés via des
   variables mutables au niveau module. Ce besoin — préserver une saisie en
   cours — appartient au store du parcours, pas au routeur.
4. **Historique non paginé et lu en mémoire.** `SqliteHistoryReader` charge les
   opérations avant de filtrer côté C#. Acceptable au volume de l'exercice,
   à pousser en SQL avant tout usage réel. Même remarque pour `GET /api/stock`
   et `GET /api/articles`, non paginés.
5. **Pas d'OpenAPI.** Le contrat n'existe que dans ce fichier, et il a déjà
   dérivé sur au moins un code d'erreur.
6. **Conventions de codes d'erreur non unifiées** : `article.validation`,
   `article_archived` et `INTERNAL_ERROR` coexistent.
7. **Stack récente et exigeante.** Angular 22 avec `@angular/forms/signals`
   encore expérimental, TypeScript 6, .NET 10, Node ≥ 24.15, et
   `--legacy-peer-deps` obligatoire à l'installation. Pari assumé pour les
   Signal Forms ; les versions ci-dessus sont celles validées.
8. **Pas de linter ni de formateur** (`.editorconfig`, ESLint, analyzers .NET).
   Le style est homogène, rien ne le tient.
9. **Playwright en série** : `workers: 1`, un seul navigateur.

---

## 7. Structure du dépôt

```text
src/backend/TokenWarehouse.Domain/          invariants métier, sans framework
src/backend/TokenWarehouse.Application/     use cases et ports
src/backend/TokenWarehouse.Infrastructure/  adapters EF Core / SQLite
src/backend/TokenWarehouse.Api/             endpoints Minimal API et composition
src/web/features/<contexte>/                Angular, un contexte par dossier
src/web/app/                                shell, routes, configuration
tests/TokenWarehouse.*.Tests/               xUnit
tests/TokenWarehouse.E2eHost/               hôte API des E2E, hors production
tests/architecture.test.mjs                 tests d'architecture
tests/e2e/                                  Playwright, API réelle
décisions d'architecture                    docs/adr/
ARCHITECTURE.md                             architecture et building blocks
CONTEXT.md                                  langage ubiquitaire
```
