# Token Warehouse — Plan de tickets du refactor Angular DDD

## 1. Objectif du lot

Transformer le frontend Angular actuel en monolithe modulaire par capacités métier, sans modifier les règles du back-office ni les contrats HTTP du backend.

Le lot applique la cible décrite dans [`ARCHITECTURE_FRONTEND_DDD_ANGULAR_2026.md`](ARCHITECTURE_FRONTEND_DDD_ANGULAR_2026.md) :

- shell Angular sans état métier ;
- routes paresseuses par capacité ;
- bounded contexts Catalogue, Stock, Ventes et Pilotage ;
- couches `domain`, `application`, `infrastructure` et `presentation` dans chaque contexte ;
- un store par parcours ;
- un gateway HTTP par contexte ;
- aucun import direct entre contextes ;
- un fichier par déclaration exportée ;
- aucune nouvelle bibliothèque d’état ou d’architecture.

## 2. Articulation avec le Kanban actuel

Les tickets E2E déjà présents ne doivent pas être recréés. Ils deviennent les garde-fous fonctionnels du refactor :

| Ticket existant | Garde-fou du ticket de refactor |
| --- | --- |
| [#73 — Socle E2E partagé](https://github.com/QServicesEntreprise/token-warehouse/issues/73) | RF-00 à RF-10 |
| [#65 — E2E Catalogue](https://github.com/QServicesEntreprise/token-warehouse/issues/65) | RF-02 Catalogue |
| [#66 — E2E Stock](https://github.com/QServicesEntreprise/token-warehouse/issues/66) | RF-03 Positions de Stock |
| [#67 — E2E Approvisionnement](https://github.com/QServicesEntreprise/token-warehouse/issues/67) | RF-04 Approvisionnements |
| [#68 — E2E Inventaire](https://github.com/QServicesEntreprise/token-warehouse/issues/68) | RF-06 Inventaires |
| [#69 — E2E Contre-mouvement](https://github.com/QServicesEntreprise/token-warehouse/issues/69) | RF-07 Contre-mouvements |
| [#70 — E2E Vente](https://github.com/QServicesEntreprise/token-warehouse/issues/70) | RF-09 Ventes |
| [#71 — E2E Historique](https://github.com/QServicesEntreprise/token-warehouse/issues/71) | RF-08 Historique |
| [#72 — E2E Dashboard](https://github.com/QServicesEntreprise/token-warehouse/issues/72) | RF-05 Pilotage |

À la demande du Product Owner, les neuf tickets E2E #65 à #73 bloquent désormais l’Epic et chacun des tickets RF-01 à RF-10. Aucun travail de refactor ne démarre avant la fermeture de toute cette barrière E2E.

#73 constitue le socle transversal et bloque déjà #65 à #72. Les tickets #65, #66, #67 et #72 partagent le verrou `e2e-smoke-split` ; leur ordre Catalogue → Stock → Approvisionnement → Dashboard reste inchangé.

## 3. Vue d’ensemble

| ID | Titre | Type | Priorité | Taille | Dépendances |
| --- | --- | --- | --- | --- | --- |
| RF-00 | Epic — Rendre le frontend Angular modulaire et évolutif | Epic | P0 | XL | #65 à #73 |
| RF-01 | Établir un shell Angular indépendant des parcours métier | Technical | P0 | L | RF-00, #65 à #73 |
| RF-02 | Rendre le Catalogue modifiable sans impact sur les opérations | Technical | P0 | XL | RF-01, #65 à #73 |
| RF-03 | Isoler la consultation des positions de Stock | Technical | P1 | M | RF-02, #65 à #73 |
| RF-04 | Isoler les Approvisionnements unitaires et en masse | Technical | P1 | L | RF-03, #65 à #73 |
| RF-05 | Rendre le Pilotage chargeable et testable indépendamment | Technical | P1 | M | RF-04, #65 à #73 |
| RF-06 | Isoler la réconciliation du Stock par Inventaire | Technical | P1 | L | RF-05, #65 à #73 |
| RF-07 | Isoler la correction explicite par Contre-mouvement | Technical | P1 | L | RF-06, #65 à #73 |
| RF-08 | Isoler la consultation de l’Historique traçable | Technical | P1 | M | RF-07, #65 à #73 |
| RF-09 | Rendre le parcours de Vente autonome et fiable | Technical | P0 | XL | RF-08, #65 à #73 |
| RF-10 | Supprimer le frontend legacy et verrouiller l’architecture | Technical | P0 | L | RF-09, #65 à #73 |

Statut demandé et appliqué : `Ready`, avec dépendances GitHub natives ouvertes.

Tous les tickets RF-01 à RF-10 utilisent le verrou `angular-refactor-root`. Ils modifient progressivement le composant monolithique et doivent rester sérialisés pour éviter des suppressions concurrentes dans les mêmes fichiers.

## 4. Graphe de dépendances

```text
#73 Socle E2E ─► #65 à #72
#65 à #73 ─────► RF-00 et chaque ticket RF-01 à RF-10

RF-00
  └─ RF-01 Shell
      └─ RF-02 Catalogue ◄─ #65
          └─ RF-03 Stock ◄─ #66
              └─ RF-04 Approvisionnements ◄─ #67
                  └─ RF-05 Pilotage ◄─ #72
                      └─ RF-06 Inventaires ◄─ #68
                          └─ RF-07 Contre-mouvements ◄─ #69
                              └─ RF-08 Historique ◄─ #71
                                  └─ RF-09 Ventes ◄─ #70
                                      └─ RF-10 Nettoyage et durcissement
```

Les dépendances sont des contraintes d’intégration, pas des frontières métier. Pilotage reste indépendant de Stock dans le code même si son ticket est exécuté après l’extraction des premières vues Stock.

---

## RF-00 — Epic — Rendre le frontend Angular modulaire et évolutif

**Champs Kanban**

- Work Type : `Epic`
- Priority : `P0`
- Size : `XL`
- Status : `Ready`
- Spec Reference : `docs/ARCHITECTURE_FRONTEND_DDD_ANGULAR_2026.md`

### Outcome

Le Gestionnaire conserve tous ses parcours, tandis que chaque capacité Angular peut évoluer, être chargée et être testée sans dépendre de l’ensemble du back-office.

### Constat de départ

- `app.component.ts` contient 2 971 lignes et orchestre tous les parcours ;
- `app.component.spec.ts` contient 2 874 lignes ;
- sept clients API regroupent 70 déclarations exportées ;
- le shell injecte six clients HTTP ;
- les DTO HTTP servent directement de modèles de présentation ;
- aucune route métier n’est chargée paresseusement.

### Scope

- création du shell routé ;
- extraction verticale de Catalogue, Stock, Ventes et Pilotage ;
- séparation Domain/Application/Infrastructure/Presentation ;
- découpage des contrats et classes en fichiers unitaires ;
- conservation des comportements, de l’accessibilité et du contrat API ;
- suppression finale du composant et des services legacy ;
- durcissement TypeScript 6 et tests d’architecture.

### Out of scope

- changement fonctionnel ou graphique ;
- modification du backend ou des contrats REST ;
- NgRx, Nx, microfrontends, CQRS ou client OpenAPI généré ;
- duplication frontend des invariants métier C#.

### Acceptance criteria

- [ ] RF-01 à RF-10 sont terminés.
- [ ] Chaque capacité possède une route paresseuse et des tests ciblés.
- [ ] `App` ne contient ni état métier ni appel HTTP.
- [ ] Aucun bounded context n’importe un autre bounded context.
- [ ] Aucun DTO HTTP n’est utilisé par un composant.
- [ ] Une déclaration exportée correspond à un fichier.
- [ ] `npm run verify` passe.

---

## RF-01 — Établir un shell Angular indépendant des parcours métier

**Champs Kanban**

- Parent issue : RF-00
- Work Type : `Technical`
- Priority : `P0`
- Size : `L`
- Status : `Ready`
- Depends on : #65 à #73
- Execution Lock : `angular-refactor-root`
- Spec Reference : `docs/ARCHITECTURE_FRONTEND_DDD_ANGULAR_2026.md#7-routage-et-composition`

### Outcome

Le Gestionnaire peut ouvrir directement chaque grande section, utiliser précédent/suivant et conserver la navigation actuelle, tandis que le shell ne porte plus d’état métier.

### What to build

- `app.ts`, `app.html`, `app.css`, `app.config.ts` et `app.routes.ts` ;
- `provideRouter` au bootstrap ;
- navigation principale avec `routerLink` et `routerLinkActive` ;
- URLs finales : `/dashboard`, `/catalogue`, `/stock`, `/stock/approvisionnements`, `/stock/inventaires`, `/stock/corrections`, `/stock/historique`, `/ventes` ;
- renommage temporaire du composant monolithique en `LegacyBackofficePage` ;
- routes temporaires qui transmettent la section attendue au composant legacy ;
- garde d’architecture frontend dans `tests/architecture.test.mjs` avec allowlist explicite des seuls fichiers legacy.

Le composant legacy constitue un étrangleur temporaire. Il doit être supprimé par RF-10, pas transformé en nouvelle couche durable.

### Out of scope

- extraction d’un contexte métier ;
- changement de formulaire, de contrat API ou de règles de validation ;
- création anticipée de tous les dossiers et types de la cible.

### Acceptance criteria

- [ ] `App` contient seulement la navigation globale et `router-outlet`.
- [ ] `App` n’injecte aucun client HTTP et ne déclare aucun Signal métier.
- [ ] Toutes les URLs finales sont accessibles directement et après rechargement.
- [ ] Précédent/suivant restaure la section attendue.
- [ ] La navigation clavier, le focus visible et l’indication de page active sont conservés.
- [ ] Les routes non encore extraites utilisent explicitement `LegacyBackofficePage`.
- [ ] L’allowlist d’architecture ne couvre aucun nouveau fichier.
- [ ] Build, tests web, tests d’architecture et suite E2E restent verts.

### Vérification

```bash
rtk npm run build:web
rtk npm run test:web
rtk npm run test:architecture
rtk npm run test:e2e
```

---

## RF-02 — Rendre le Catalogue modifiable sans impact sur les opérations

**Champs Kanban**

- Parent issue : RF-00
- Work Type : `Technical`
- Priority : `P0`
- Size : `XL`
- Status : `Ready`
- Execution Lock : `angular-refactor-root`
- Spec Reference : `docs/ARCHITECTURE_FRONTEND_DDD_ANGULAR_2026.md#31-catalogue`
- Depends on : RF-01, #65 à #73

### Outcome

Le Gestionnaire recherche, crée, consulte, modifie, archive et réactive un Article depuis des pages Catalogue autonomes, sans charger les parcours Stock, Vente ou Pilotage.

### What to build

- contexte `catalogue/domain|application|infrastructure|presentation` ;
- routes `/catalogue`, `/catalogue/nouveau` et `/catalogue/:ean13` ;
- `CatalogueGateway`, token, adapter HTTP et fake de test ;
- `CatalogueListStore`, `ArticleCreateStore` et `ArticleDetailsStore` fournis par route ;
- modèles Catalogue distincts des DTO HTTP ;
- un fichier par interface, type, classe, token ou fonction exportée ;
- pages standalone avec `.ts`, `.html`, `.css` et `.spec.ts` ;
- Signal Forms de création et modification ;
- mapping Problem Details vers les champs ;
- déplacement des styles et tests Catalogue ;
- découplage du service Vente legacy des types Catalogue : vocabulaire stable vers le shared kernel et projection tarifaire propre à Ventes ;
- suppression de `article-api.service.ts` et des responsabilités Catalogue du legacy.

### Out of scope

- opération de Stock depuis Catalogue ;
- recalcul frontend de TVA ou de vendabilité ;
- changement des endpoints `/api/articles`.

### Acceptance criteria

- [ ] Les trois routes Catalogue sont lazy-loaded.
- [ ] Aucun composant Catalogue ne connaît un type `*Dto`, `*Payload` ou `*Response`.
- [ ] Les DTO restent dans `catalogue/infrastructure/dto` avec un fichier par déclaration.
- [ ] Les Signals mutables sont privés aux stores et exposés en lecture seule.
- [ ] Les erreurs serveur restent rattachées aux champs concernés.
- [ ] Archivage et réactivation conservent leur focus et leur annonce accessible.
- [ ] Le code Vente legacy n’importe ni le nouveau contexte Catalogue ni `article-api.service.ts`.
- [ ] `article-api.service.ts` n’existe plus.
- [ ] Le legacy ne contient plus de template, état ou méthode Catalogue.
- [ ] Les tests web Catalogue et le ticket E2E #65 passent sans modification du contrat backend.

### Vérification

```bash
rtk npm run build:web
rtk npm run test:web
rtk npm run test:architecture
rtk npx playwright test tests/e2e/catalogue.spec.ts
```

---

## RF-03 — Isoler la consultation des positions de Stock

**Champs Kanban**

- Parent issue : RF-00
- Work Type : `Technical`
- Priority : `P1`
- Size : `M`
- Status : `Ready`
- Execution Lock : `angular-refactor-root`
- Spec Reference : `docs/ARCHITECTURE_FRONTEND_DDD_ANGULAR_2026.md#32-stock`
- Depends on : RF-02, #65 à #73

### Outcome

Le Gestionnaire consulte les quantités physiques, vendables et bloquées depuis une page Stock autonome qui n’importe aucun modèle Catalogue.

### What to build

- structure initiale du contexte `stock` ;
- modèle `StockPosition` et vocabulaire de disponibilité ;
- `StockGateway`, token et premier adapter HTTP ;
- `StockPositionStore` et état discriminé de chargement ;
- route paresseuse `/stock` ;
- page standalone et tests ciblés ;
- annulation des lectures obsolètes lors des filtres ;
- retrait de la vue, de l’état et des méthodes de position du legacy.

### Out of scope

- Approvisionnement, Inventaire, correction et Historique ;
- règle de calcul du Stock vendable côté frontend ;
- changement de `GET /api/stock`.

### Acceptance criteria

- [ ] `/stock` fonctionne sans charger le composant legacy.
- [ ] La page dépend uniquement de `StockPositionStore`.
- [ ] Le store dépend de `StockGateway`, jamais de `HttpClient`.
- [ ] Les positions sont des modèles Stock et non des DTO.
- [ ] Les états loading, ready, empty et error restent distingués et accessibles.
- [ ] Une réponse obsolète ne remplace pas le dernier filtre demandé.
- [ ] Le ticket E2E #66 et les tests web Stock passent.

### Vérification

```bash
rtk npm run build:web
rtk npm run test:web
rtk npm run test:architecture
rtk npx playwright test tests/e2e/stock.spec.ts
```

---

## RF-04 — Isoler les Approvisionnements unitaires et en masse

**Champs Kanban**

- Parent issue : RF-00
- Work Type : `Technical`
- Priority : `P1`
- Size : `L`
- Status : `Ready`
- Execution Lock : `angular-refactor-root`
- Spec Reference : `docs/ARCHITECTURE_FRONTEND_DDD_ANGULAR_2026.md#32-stock`
- Depends on : RF-03, #65 à #73

### Outcome

Le Gestionnaire réceptionne un ou plusieurs Articles depuis un parcours Approvisionnement isolé, avec le même résultat atomique et les mêmes erreurs qu’avant le refactor.

### What to build

- commandes `RecordSupplyCommand` et `RecordBulkSupplyCommand` ;
- méthodes d’Approvisionnement dans `StockGateway` et son adapter HTTP ;
- DTO et mappings dédiés, un par fichier ;
- `SupplyStore` route-scoped ;
- route paresseuse `/stock/approvisionnements` ;
- Signal Form unitaire et saisie en masse ;
- prévention du double envoi et protection contre les réponses obsolètes ;
- découplage des consommateurs legacy Ventes et Dashboard des types définis dans `stock-api.service.ts`, via le shared kernel ou leurs projections contextuelles ;
- suppression de la partie Approvisionnement du legacy et de l’ancien client Stock devenu sans consommateur.

### Out of scope

- validation métier de l’atomicité côté navigateur ;
- fusion avec le parcours Inventaire ;
- repository ou store générique pour les opérations de Stock.

### Acceptance criteria

- [ ] Les modes unitaire et masse utilisent le même `SupplyStore` sans partager l’état des autres opérations.
- [ ] Une commande de masse est envoyée une seule fois et son résultat est présenté en totalité.
- [ ] Les erreurs conservent la saisie et le focus attendu.
- [ ] Aucun calcul de quantité résultante n’est anticipé côté frontend.
- [ ] Les consommateurs legacy restants n’importent plus `stock-api.service.ts`.
- [ ] `stock-api.service.ts` est supprimé.
- [ ] Le legacy ne contient plus de code d’Approvisionnement.
- [ ] Le ticket E2E #67 et les tests web Approvisionnement passent.

### Vérification

```bash
rtk npm run build:web
rtk npm run test:web
rtk npm run test:architecture
rtk npx playwright test tests/e2e/supply.spec.ts
```

---

## RF-05 — Rendre le Pilotage chargeable et testable indépendamment

**Champs Kanban**

- Parent issue : RF-00
- Work Type : `Technical`
- Priority : `P1`
- Size : `M`
- Status : `Ready`
- Execution Lock : `angular-refactor-root`
- Spec Reference : `docs/ARCHITECTURE_FRONTEND_DDD_ANGULAR_2026.md#34-pilotage`
- Depends on : RF-04, #65 à #73

### Outcome

Le Gestionnaire ouvre le Dashboard sans charger les parcours d’écriture, et les évolutions de Pilotage ne dépendent plus des modèles internes du Stock.

### What to build

- contexte `dashboard/domain|application|infrastructure|presentation` ;
- projections `Dashboard`, lignes de stock, flux et synthèse TVA ;
- `DashboardGateway`, adapter HTTP, DTO et mappings ;
- `DashboardStore` route-scoped ;
- route lazy-loaded `/dashboard` ;
- filtres, états et rendu accessibles existants ;
- suppression des imports de types provenant de Stock ;
- remplacement puis suppression de `dashboard.component.ts` et `dashboard-api.service.ts`.

### Out of scope

- mutation de Stock depuis le Dashboard ;
- reconstitution historique du Stock ;
- bibliothèque de graphiques ou store global.

### Acceptance criteria

- [ ] Pilotage n’importe aucun fichier de `catalogue`, `stock` ou `sales`.
- [ ] Les filtres déclenchent une lecture annulable avec le dernier résultat faisant autorité.
- [ ] Les modèles de page ne portent aucun suffixe de transport.
- [ ] Les états loading, empty et error et la restauration du focus sont conservés.
- [ ] Les anciens fichiers Dashboard sont supprimés.
- [ ] Le ticket E2E #72 et les tests web Dashboard passent.

### Vérification

```bash
rtk npm run build:web
rtk npm run test:web
rtk npm run test:architecture
rtk npx playwright test tests/e2e/dashboard.spec.ts
```

---

## RF-06 — Isoler la réconciliation du Stock par Inventaire

**Champs Kanban**

- Parent issue : RF-00
- Work Type : `Technical`
- Priority : `P1`
- Size : `L`
- Status : `Ready`
- Execution Lock : `angular-refactor-root`
- Spec Reference : `docs/ARCHITECTURE_FRONTEND_DDD_ANGULAR_2026.md#32-stock`
- Depends on : RF-05, #65 à #73

### Outcome

Le Gestionnaire réconcilie le Stock par Inventaire unitaire ou en masse depuis un parcours autonome, sans mélanger son brouillon avec un Approvisionnement ou une Vente.

### What to build

- commandes unitaires et masse d’Inventaire ;
- extension de `StockGateway` et de l’adapter HTTP ;
- DTO et mappings Inventaire ;
- `InventoryStore` route-scoped ;
- route `/stock/inventaires` ;
- Signal Form et restauration contrôlée du brouillon si ce comportement est conservé ;
- suppression des compteurs de requêtes manuels au profit d’une orchestration locale au store ;
- retrait du code Inventaire du legacy et suppression de `inventory-api.service.ts`.

### Out of scope

- recalcul client de l’écart ou du Stock résultant ;
- partage du formulaire avec Approvisionnement ;
- changement des règles d’atomicité backend.

### Acceptance criteria

- [ ] Les brouillons d’Inventaire ne survivent ni ne contaminent un autre parcours.
- [ ] Les résultats et écarts affichés proviennent de la réponse serveur.
- [ ] Un échec en masse ne rend aucun succès partiel.
- [ ] Le double envoi est impossible pendant une mutation.
- [ ] `inventory-api.service.ts` et le code legacy correspondant sont supprimés.
- [ ] Le ticket E2E #68 et les tests web Inventaire passent.

### Vérification

```bash
rtk npm run build:web
rtk npm run test:web
rtk npm run test:architecture
rtk npx playwright test tests/e2e/inventory.spec.ts
```

---

## RF-07 — Isoler la correction explicite par Contre-mouvement

**Champs Kanban**

- Parent issue : RF-00
- Work Type : `Technical`
- Priority : `P1`
- Size : `L`
- Status : `Ready`
- Execution Lock : `angular-refactor-root`
- Spec Reference : `docs/ARCHITECTURE_FRONTEND_DDD_ANGULAR_2026.md#32-stock`
- Depends on : RF-06, #65 à #73

### Outcome

Le Gestionnaire corrige une opération depuis un parcours explicite dont l’état et les sources éligibles ne peuvent pas être affectés par une autre page.

### What to build

- modèle de source corrigeable et résultat de correction ;
- `RecordCounterMovementCommand` ;
- extension de `StockGateway` pour la liste des sources et la correction ;
- DTO et mappings, dont les données financières ;
- `CounterMovementStore` route-scoped ;
- route `/stock/corrections` ;
- Signal Form avec justification et mapping des erreurs ;
- retrait des compteurs de requêtes et de la section legacy ;
- suppression de `counter-movement-api.service.ts`.

### Out of scope

- décision frontend sur l’éligibilité réelle d’une source ;
- modification ou suppression de l’opération source ;
- recalcul des montants financiers inversés.

### Acceptance criteria

- [ ] Seul le gateway Stock fournit les sources corrigeables.
- [ ] Le store ignore ou annule une ancienne liste de sources.
- [ ] La justification et les erreurs serveur restent liées au formulaire.
- [ ] Le résultat financier affiché est celui renvoyé par l’API.
- [ ] Aucun import Ventes n’est nécessaire au contexte Stock.
- [ ] L’ancien service et le code legacy sont supprimés.
- [ ] Le ticket E2E #69 et les tests web Contre-mouvement passent.

### Vérification

```bash
rtk npm run build:web
rtk npm run test:web
rtk npm run test:architecture
rtk npx playwright test tests/e2e/counter-movement.spec.ts
```

---

## RF-08 — Isoler la consultation de l’Historique traçable

**Champs Kanban**

- Parent issue : RF-00
- Work Type : `Technical`
- Priority : `P1`
- Size : `M`
- Status : `Ready`
- Execution Lock : `angular-refactor-root`
- Spec Reference : `docs/ARCHITECTURE_FRONTEND_DDD_ANGULAR_2026.md#32-stock`
- Depends on : RF-07, #65 à #73

### Outcome

Le Gestionnaire consulte l’Historique global ou par Article depuis une projection Stock en lecture seule, sans charger le Catalogue ou le parcours de Vente.

### What to build

- modèles `HistoryEntry`, lignes, changements et inversions financières ;
- requête d’Historique dans `StockGateway` ;
- DTO et mappings dédiés ;
- `HistoryStore` route-scoped ;
- route `/stock/historique` avec filtre EAN-13 optionnel ;
- composant de page et rendu des neuf types de faits ;
- suppression de `history-api.service.ts` et du code Historique du legacy.

### Out of scope

- écriture ou correction depuis l’Historique ;
- agrégation Dashboard ;
- interprétation locale des montants historiques.

### Acceptance criteria

- [ ] L’Historique global et le filtre Article utilisent le même store avec des requêtes explicites.
- [ ] Une réponse d’un ancien filtre ne remplace pas le filtre courant.
- [ ] Les modèles d’Historique appartiennent au contexte Stock et ne sont pas partagés avec Ventes.
- [ ] La page reste strictement en lecture seule et accessible.
- [ ] L’ancien service et le code legacy sont supprimés.
- [ ] Le ticket E2E #71 et les tests web Historique passent.

### Vérification

```bash
rtk npm run build:web
rtk npm run test:web
rtk npm run test:architecture
rtk npx playwright test tests/e2e/history.spec.ts
```

---

## RF-09 — Rendre le parcours de Vente autonome et fiable

**Champs Kanban**

- Parent issue : RF-00
- Work Type : `Technical`
- Priority : `P0`
- Size : `XL`
- Status : `Ready`
- Execution Lock : `angular-refactor-root`
- Spec Reference : `docs/ARCHITECTURE_FRONTEND_DDD_ANGULAR_2026.md#33-ventes`
- Depends on : RF-08, #65 à #73

### Outcome

Le Gestionnaire recherche un Article vendable, obtient son devis et valide une Vente depuis un contexte autonome qui ne dépend ni du Catalogue ni des classes Stock.

### What to build

- contexte `sales/domain|application|infrastructure|presentation` ;
- projection `SellableArticle`, devis et résultat de Vente ;
- `SalesGateway`, token, adapter HTTP, DTO et mappings ;
- `SaleStore` route-scoped ;
- port `LastSaleStorage` et adapter `SessionLastSaleStorage` ;
- route lazy-loaded `/ventes` ;
- Signal Form et sélection du Contexte de Vente ;
- restauration de la dernière Vente sans accès direct à `sessionStorage` depuis le composant ;
- conservation des montants renvoyés par l’API sans recalcul ;
- suppression des imports provenant du client Stock ;
- suppression de `sales-api.service.ts` et du code Vente du legacy.

### Out of scope

- moteur de prix ou de TVA frontend ;
- décision locale de vendabilité ;
- état global partagé avec Stock ou Catalogue.

### Acceptance criteria

- [ ] `sales` n’importe aucun fichier de `catalogue`, `stock` ou `dashboard`.
- [ ] `SellableArticle` est une projection propre au parcours Vente.
- [ ] Le devis et le reçu affichent strictement les montants serveur.
- [ ] Une Vente ne peut pas être soumise deux fois pendant la même mutation.
- [ ] La restauration de session est testée via le port de stockage.
- [ ] Les erreurs conservent le brouillon et le focus attendu.
- [ ] L’ancien service et le code legacy sont supprimés.
- [ ] Le ticket E2E #70 et les tests web Vente passent.

### Vérification

```bash
rtk npm run build:web
rtk npm run test:web
rtk npm run test:architecture
rtk npx playwright test tests/e2e/sale.spec.ts
```

---

## RF-10 — Supprimer le frontend legacy et verrouiller l’architecture

**Champs Kanban**

- Parent issue : RF-00
- Work Type : `Technical`
- Priority : `P0`
- Size : `L`
- Status : `Ready`
- Execution Lock : `angular-refactor-root`
- Spec Reference : `docs/ARCHITECTURE_FRONTEND_DDD_ANGULAR_2026.md#13-criteres-dacceptation-de-larchitecture`
- Depends on : RF-09, #65 à #73

### Outcome

Le frontend ne contient plus de chemin legacy, et les règles Angular/DDD deviennent des contraintes exécutables qui empêchent le retour au composant monolithique.

### What to build

- suppression de `LegacyBackofficePage`, de son test et des routes temporaires ;
- suppression de tout ancien `*-api.service.ts` restant ;
- retrait de l’allowlist temporaire du test d’architecture ;
- répartition des styles restants entre shell, pages et styles globaux ;
- mise à jour de TypeScript depuis `6.0.0-beta` vers une version stable `>=6.0 <6.1` compatible Angular ;
- activation de `verbatimModuleSyntax`, `isolatedModules`, `moduleDetection: force`, `noUncheckedSideEffectImports`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals` et `noUnusedParameters` ;
- conversion en `import type` ;
- test d’architecture final pour les directions d’import et la déclaration unique par fichier ;
- exécution de la chaîne de vérification complète.

### Out of scope

- nouvelle fonctionnalité ;
- refonte graphique ;
- ajout d’un linter ou d’une bibliothèque de contrôle de frontières si `node:test` suffit ;
- alias de chemins ou barrels sans nécessité mesurée.

### Acceptance criteria

- [ ] Aucun fichier ou symbole legacy ne subsiste.
- [ ] `App` ne contient que le shell.
- [ ] Aucun bounded context n’importe un autre bounded context.
- [ ] `domain` n’importe ni Angular ni RxJS.
- [ ] `application` et `presentation` n’importent pas `HttpClient` ni les DTO.
- [ ] Chaque fichier de production exporte au plus une déclaration top-level.
- [ ] Aucun `models.ts`, `types.ts`, `utils.ts`, barrel ou base générique n’est présent.
- [ ] Toutes les options TypeScript cibles sont actives sans erreur.
- [ ] Les routes sont toutes lazy-loaded et aucune route temporaire ne subsiste.
- [ ] `npm run verify` passe intégralement.

### Vérification

```bash
rtk npm run verify
rtk git diff --check
```

## 5. Règles communes à copier dans chaque ticket GitHub

### Definition of Done

- comportement observable inchangé hors navigation par URL ;
- aucun changement de contrat backend ;
- pas de duplication d’invariant métier ;
- pas de nouvelle dépendance npm sans décision séparée ;
- un fichier par déclaration exportée ;
- tests déplacés, jamais copiés en laissant les anciens ;
- code legacy du périmètre supprimé dans le même ticket ;
- vérification ciblée puis non-régression complète proportionnée au risque ;
- accessibilité existante conservée.

### Règle de migration

Une tranche est terminée uniquement lorsqu’elle remplace réellement le code legacy correspondant. Ajouter la nouvelle architecture sans supprimer l’ancienne n’est pas une livraison.

### Règle de test

Le test reste au niveau le plus bas capable de prouver le comportement :

- fonctions pures : Vitest sans TestBed ;
- stores : fake du gateway ;
- adapters HTTP : `HttpTestingController` ;
- composants et Signal Forms : TestBed/Vitest ;
- parcours utilisateur : Playwright ;
- frontières : `node:test` existant.

## 6. Matérialisation GitHub

1. RF-00 est créé en [#74](https://github.com/QServicesEntreprise/token-warehouse/issues/74), avec RF-01 à RF-10 en sous-tickets [#75](https://github.com/QServicesEntreprise/token-warehouse/issues/75) à [#84](https://github.com/QServicesEntreprise/token-warehouse/issues/84).
2. Les onze items appartiennent au Project 1 et portent les champs Priority, Size, Work Type, Execution Lock et Spec Reference indiqués.
3. Les onze items sont en `Ready`, sans label `ready-for-agent` ajouté.
4. Les neuf tickets E2E #65 à #73 sont des bloqueurs GitHub natifs de l’Epic et de chaque ticket d’exécution.
5. La chaîne interne #75 → #76 → … → #84 impose ensuite l’ordre du refactor.
6. Aucun ticket de refactor ne devient exécutable tant que les neuf bloqueurs E2E ne sont pas fermés.

Ce plan crée onze issues nouvelles : un Epic et dix tickets d’exécution. Les neuf tickets E2E existants sont réutilisés tels quels.
