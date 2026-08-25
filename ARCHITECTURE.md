# Token Warehouse — Architecture

## 1. Intent

Token Warehouse est un back-office mono-entrepôt livré comme un monolithe modulaire. L’architecture doit rendre les invariants métier visibles et testables, tout en restant assez petite pour être terminée et expliquée pendant un exercice de recrutement.

Le système n’est pas conçu comme une plateforme distribuée. La métaphore Token Warehouse appartient aux données de démonstration ; elle ne change pas les règles du domaine.

## 2. Stack retenue

| Zone | Choix | Raison |
| --- | --- | --- |
| Frontend | Angular 22, composants standalone, Signals et Signal Forms | Framework demandé, état local lisible et formulaires typés adaptés à une nouvelle application basée sur Signals. |
| Backend | C# avec ASP.NET Core 10 Minimal API | API HTTP légère, injection de dépendances native et peu de boilerplate pour le timebox. |
| Persistance | EF Core 10 avec SQLite dans un fichier local | Persistance durable sans service externe ni installation de base serveur. |
| Tests navigateur | Playwright | Vérification des parcours utilisateur prioritaires dans l’interface réelle. |
| Contrat HTTP | REST JSON | Contrat simple, observable et consommable par Angular sans génération de client obligatoire. |

La version Angular 22 est choisie pour utiliser Signal Forms dans la version actuelle visée. Les formulaires restent limités aux cas où une validation de modèle est utile ; aucun framework de formulaire ou composant UI supplémentaire n’est ajouté par principe.

Le backend cible le SDK .NET 10 disponible dans l’environnement de delivery. Le fichier SQLite est adapté à l’exercice local et ne constitue pas un engagement de montée en charge multi-instance.

## 3. Forme générale

Le backend est un monolithe modulaire organisé selon quatre zones :

```text
Angular
   │ HTTP JSON
   ▼
Presentation / HTTP adapter
   ▼
Application / use cases
   ▼
Domain / invariants
   ▲
Infrastructure / adapters EF Core, SQLite, horloge, transaction
```

La composition des dépendances se fait dans la Presentation. Le runtime peut donc brancher les adapters Infrastructure sur les ports définis par l’Application, sans que le Domain connaisse ASP.NET Core, EF Core, SQLite ou Angular.

Arborescence cible minimale :

```text
backend/
  TokenWarehouse.Domain/
  TokenWarehouse.Application/
  TokenWarehouse.Infrastructure/
  TokenWarehouse.Presentation/
frontend/
  token-warehouse-web/
tests/
  TokenWarehouse.Domain.Tests/
  TokenWarehouse.Application.Tests/
  TokenWarehouse.Api.IntegrationTests/
  token-warehouse-web/e2e/
```

Cette arborescence est une proposition de séparation, pas une obligation de créer un projet ou un dossier pour chaque terme DDD. Une séparation n’est conservée que si elle porte une responsabilité réelle.

## 4. Modules métier

### Catalogue d’Articles

Responsable de l’identité et du cycle de vie d’un Article : EAN-13, classification alimentaire/non alimentaire, DLC, mode de consommation, Packaging, Prix HT, archivage et réactivation.

### Stock fiable et traçable

Responsable du Stock physique, du Stock vendable, des Approvisionnements, des Inventaires, des Écarts d’inventaire, des Contre-mouvements et de l’Historique des opérations.

### Ventes simulées

Responsable de la Vente, du Contexte de Vente, de la vérification de vendabilité, de la diminution du stock et du Contexte tarifaire de Vente. Une Vente conserve ses montants HT, TVA et TTC au moment de sa validation.

### Pilotage

Responsable des lectures agrégées du Dashboard : KPI, ruptures, Articles non vendables, flux quotidiens, stock par Article, chiffre d’affaires HT/TTC et TVA collectée par Taux de TVA.

Le module de Pilotage est une capacité de lecture. Il ne devient pas un second modèle métier et ne duplique pas les règles de stock ou de prix.

## 5. Domain — building blocks justifiés

### Aggregates et entités

- **Article** est l’aggregate root du catalogue. Il protège l’identité EAN-13, la classification immuable, le Prix HT et les changements autorisés de DLC, Packaging et cycle de vie.
- **StockPosition** est l’aggregate root de la position courante d’un Article. Il protège la quantité physique, la base issue du dernier Inventaire et les règles de non-négativité lors des opérations.
- **StockOperation** est une entité métier immuable représentant un Approvisionnement, une Vente, un Inventaire ou un Contre-mouvement. Elle conserve les informations nécessaires à l’Historique ; une Vente contient aussi son Contexte tarifaire et ses montants.

Les opérations historiques ne sont pas un event store générique. Elles sont des enregistrements métier explicites, écrits dans la même transaction que la position courante.

### Value objects

Les value objects sont utilisés là où ils portent une règle, pas pour décorer les propriétés :

- `Ean13` : 13 chiffres, checksum valide et comparaison normalisée ;
- `Money` : montant en euros au centime, représenté en cents dans le domaine ;
- `Quantity` : quantité entière positive ou nulle selon l’opération ;
- `TaxRate` : taux autorisé et calcul de TVA ;
- `SaleContext` : à emporter ou sur place ;
- dates et identifiants de domaine lorsque leur validation ou leur format est métier.

### Policies

- `PricingPolicy` détermine le Taux de TVA et calcule les Montants d’une Vente à partir du contexte tarifaire ; elle applique l’arrondi au centime.
- `SellabilityPolicy` détermine le Stock vendable à partir de l’état de l’Article, de sa DLC ou de son Packaging et de la date locale de l’Entrepôt.

Ces policies sont petites, déterministes et directement testables. Aucun domain service ou bus d’événements n’est ajouté tant qu’une policy ou un use case suffit.

## 6. Application — use cases

L’Application orchestre les cas d’utilisation et les transactions. Elle ne contient ni types EF Core ni objets HTTP.

Use cases principaux :

- lister, rechercher, créer, modifier, archiver et réactiver un Article ;
- enregistrer un Approvisionnement unitaire ou en masse ;
- enregistrer un Inventaire unitaire ou en masse ;
- enregistrer une Vente ;
- enregistrer un Contre-mouvement ;
- lire le Stock courant et l’Historique ;
- lire le Dashboard sur une période et avec ses filtres.

Le code utilise des classes de use case explicites et des commandes ou requêtes simples lorsque cela rend le contrat plus lisible. Il n’y a pas de bus Mediator, de pipeline CQRS ou de framework de messaging.

Une opération en masse est validée entièrement avant son application. L’Application ouvre une transaction, orchestre les positions concernées et écrit les opérations ; toute erreur annule l’ensemble.

## 7. Infrastructure — adapters et persistance

### Ports réellement nécessaires

Les ports appartiennent à l’Application ou au Domain selon leur nature :

- stockage d’Article par EAN-13 ;
- stockage de `StockPosition` ;
- lecture et écriture des `StockOperation` ;
- lecture dédiée du Dashboard et de l’Historique ;
- `Clock` pour rendre la DLC et les horodatages déterministes dans les tests ;
- transaction applicative pour les opérations en masse et les Contre-mouvements.

Ces ports sont spécifiques aux comportements attendus. Il n’y a pas de `IGenericRepository<T>`, d’unité de travail exposée partout ou d’interface créée uniquement parce qu’un pattern le suggère.

### Adapters

- EF Core implémente les ports de persistance ;
- SQLite fournit le stockage local durable ;
- un adapter d’horloge fournit l’heure de production et un faux contrôle en test ;
- l’adapter de lecture du Dashboard exécute des requêtes SQL/EF explicites adaptées aux agrégations demandées.

Les entités de persistance et leurs configurations restent dans Infrastructure. Les objets du Domain ne portent pas d’attribut EF Core et ne sont pas exposés directement par l’API.

### Stratégie de stockage

Le fichier local `token-warehouse.db` contient au minimum :

- les Articles et leur état de cycle de vie ;
- les positions de stock courantes ;
- les opérations immuables et leurs liens de correction ;
- les données tarifaires figées des Ventes.

La position courante est persistée pour valider rapidement les ventes et afficher le stock. Les opérations restent conservées pour l’Historique et les agrégations. Cette combinaison donne de la traçabilité sans adopter l’event sourcing.

L’EAN-13 possède une contrainte d’unicité en base en plus de la validation de domaine. Les suppressions physiques d’Article et d’opération ne sont pas utilisées.

Les migrations EF Core définissent le schéma. Le démarrage local peut appliquer les migrations prévues pour le développement ; aucune stratégie de migration cloud ou de réplication n’est nécessaire au MVP.

## 8. Presentation et API

### Backend HTTP

La Presentation ASP.NET Core expose des endpoints Minimal API. Elle :

- désérialise les DTO d’entrée ;
- applique la validation structurelle ;
- appelle un use case ;
- mappe le résultat vers un DTO de sortie ;
- transforme les erreurs connues en Problem Details.

Elle ne charge pas directement un `DbContext`, ne calcule pas le stock et ne décide pas de la TVA.

Ressources principales :

| Méthode | Ressource | Capacité |
| --- | --- | --- |
| `GET` | `/api/articles` | recherche et liste des Articles actifs ou archivés selon filtre |
| `POST` | `/api/articles` | créer un Article |
| `GET` | `/api/articles/{ean13}` | consulter un Article et son stock |
| `PATCH` | `/api/articles/{ean13}` | modifier les attributs autorisés |
| `POST` | `/api/articles/{ean13}/archive` | archiver |
| `POST` | `/api/articles/{ean13}/reactivate` | réactiver |
| `POST` | `/api/supplies` et `/api/supplies/bulk` | enregistrer un Approvisionnement |
| `GET` | `/api/supplies/{id}` | relire une Opération d’Approvisionnement immuable |
| `POST` | `/api/inventories` et `/api/inventories/bulk` | enregistrer un Inventaire |
| `POST` | `/api/sales` | enregistrer une Vente |
| `POST` | `/api/stock/counter-movements` | corriger une opération |
| `GET` | `/api/stock` | lire les positions courantes |
| `GET` | `/api/history` | lire l’Historique global ou par Article |
| `GET` | `/api/dashboard` | lire les KPI, les flux quotidiens et les filtres |

Les noms et verbes de cette table fixent la stratégie REST. Les payloads détaillés seront produits par la boucle Product Owner puis raffinés techniquement.

### Contrat d’échange

- JSON UTF-8 ;
- EAN-13 comme identifiant externe d’un Article ;
- dates de DLC au format calendrier `YYYY-MM-DD` ;
- horodatages d’opérations en ISO-8601 UTC ;
- quantités entières ;
- montants financiers transportés en cents dans les DTO pour éviter les erreurs de flottants, puis formatés en euros dans Angular ;
- réponses de collection paginables seulement si le volume le justifie ; pas de pagination spéculative au premier écran.

### Erreurs

Toutes les erreurs HTTP structurées utilisent `application/problem+json` :

- `400` : JSON mal formé ou validation structurelle ;
- `404` : Article ou opération inconnue ;
- `409` : conflit métier, par exemple EAN déjà utilisé, Article archivé, stock vendable insuffisant, Article expiré ou Invendable ;
- `500` : erreur inattendue, sans détail interne exposé.

Les erreurs de validation de champs contiennent des clés exploitables par Signal Forms. Les erreurs métier portent un code stable et un message lisible ; le frontend ne dépend pas du texte pour prendre une décision.

## 9. Frontend Angular

Le frontend est un adapter de présentation :

- composants standalone organisés par parcours métier ;
- Signals pour l’état de page, les filtres et les données dérivées ;
- Signal Forms pour les formulaires de création/modification et de saisie d’opérations ;
- un client HTTP typé par ressource, sans miroir du domaine C# ;
- mapping des erreurs Problem Details vers les champs et les messages de parcours ;
- états explicites `loading`, `ready`, `empty` et `error` ;
- montants présentés et saisis en euros, la virgule et le point valant le même séparateur décimal.

Les montants restent des centimes entiers dans la persistance et dans les payloads HTTP, conformément au §13. La conversion euros ↔ centimes vit à la seule frontière de présentation : le Gestionnaire ne lit ni ne saisit jamais de centimes.

Les règles métier critiques sont répétées en validation d’ergonomie côté Angular uniquement pour guider l’utilisateur. La source d’autorité reste le Domain backend ; une requête valide côté frontend peut toujours être refusée par l’API.

L’interface reste un back-office professionnel : navigation lisible, tableaux et formulaires sobres, états vides utiles et accessibilité de base. L’humour est réservé aux noms, descriptions et données de démonstration.

## 10. Règles de dépendance

1. Domain ne dépend d’aucun framework web, ORM, base de données ou composant Angular.
2. Application dépend du Domain et définit les ports dont ses use cases ont besoin.
3. Infrastructure dépend du Domain/Application pour implémenter les ports ; elle n’impose pas ses types au reste du système.
4. Presentation dépend de l’Application et assemble les adapters Infrastructure au démarrage.
5. Angular ne partage pas de classes de domaine avec C# ; le contrat est le JSON de l’API.
6. Aucun controller, endpoint, composant Angular ou configuration EF ne porte seul une règle métier.
7. Les mappings DTO/domaine sont aux seams HTTP et persistance, pas au milieu des agrégats.

## 11. Seams de test

| Seam | Remplacement en test | Ce que cela permet de vérifier |
| --- | --- | --- |
| Policies et value objects | Aucun adapter, tests directs | invariants, calculs et règles aux limites |
| Ports de persistance Application | fakes en mémoire | orchestration des use cases et erreurs métier |
| `Clock` | horloge fixe | DLC exacte, ordre et dates d’Historique |
| Transaction | adapter SQLite réel ou fake contrôlé | atomicité des opérations en masse |
| Presentation HTTP | `WebApplicationFactory` + SQLite in-memory | contrat JSON, status codes, Problem Details et persistance réelle |
| Client Angular | `HttpClientTesting` / faux backend | mapping des réponses, validation et états UI |
| Parcours navigateur | Playwright | comportement observable de bout en bout |

Un seam est conservé lorsqu’il protège un comportement ou une variation réelle. Une abstraction à implémentation unique sans bénéfice de test ou de remplacement est supprimée.

## 12. Stratégie de tests

### Domain

Tests rapides et sans infrastructure pour : EAN-13, classification immuable, prix et taux, arrondis, DLC au jour exact, Packaging Invendable, archivage, stocks négatifs, inventaires successifs, ventes et Contre-mouvements.

### Application

Tests de use cases avec fakes des ports : opérations unitaires et en masse, rollback global, vente refusée, correction liée, historique et dashboard sur période.

### Intégration API

Tests avec le vrai pipeline ASP.NET Core et SQLite in-memory. La connexion SQLite reste ouverte pendant le test afin de conserver le schéma et les données ; les contraintes, transactions et requêtes EF sont ainsi réellement exercées.

### Frontend

Tests ciblés des formulaires Signal Forms, du mapping Problem Details, des états vides/erreur et des filtres. Ils vérifient les comportements publics des composants plutôt que leur structure interne.

### E2E Playwright

Les scénarios minimums couvrent :

1. créer un Article, l’approvisionner et constater son stock vendable ;
2. saisir une Vente, constater la diminution du stock et les montants HT/TTC/TVA ;
3. réaliser un Inventaire ou une correction, consulter l’Historique ;
4. ouvrir le Dashboard et vérifier KPI, alertes, indicateurs financiers, filtres et états vides.

Les fixtures de démonstration rendent visibles les cas alimentaires, les deux modes, la DLC proche, l’Article Invendable et les infrastructures reconditionnées.

## 13. Guidelines d’engineering

- Employer les termes de [`CONTEXT.md`](CONTEXT.md) dans les noms de code, tickets et tests.
- Préférer une tranche verticale complète par use case à une livraison séparée « backend puis frontend ».
- Utiliser `Money` et des cents, jamais `float` ou `double` pour les montants.
- Utiliser une horloge injectée ; ne pas appeler directement l’heure système dans le Domain.
- Garder les opérations validées immuables ; corriger par opération explicite.
- Faire respecter les règles à la frontière HTTP et dans le Domain ; la base est une protection supplémentaire.
- Retourner des résultats explicites plutôt que faire remonter des exceptions techniques comme contrat métier.
- Tester les comportements observables et les scénarios limites avant les détails de classes.
- Garder les pages de Dashboard en lecture ; aucune écriture cachée dans une requête.
- Ne pas ajouter de dépendance frontend ou backend sans bénéfice démontré sur un parcours du MVP.

## 14. Ce qui est volontairement absent

- microservices et communication réseau interne ;
- CQRS complet, bus de commandes et event sourcing ;
- event bus, projections distribuées et traitement asynchrone ;
- generic repositories, base classes DDD et factories spéculatives ;
- authentification, rôles et multi-entrepôts ;
- fournisseur, paiement, facturation, intégrations externes et scan matériel ;
- historique dédié des modifications de Prix HT ;
- moteur d’analytics, notifications et seuils configurables au-delà du MVP.

Ces éléments pourraient être ajoutés après une nouvelle décision produit. Ils ne sont pas des prérequis cachés de l’architecture actuelle.

## 15. Compromis à expliquer en entretien

### Monolithe modulaire plutôt que microservices

Le projet est petit et mono-entrepôt. Le monolithe réduit le coût opérationnel, tout en conservant des seams Domain/Application/Infrastructure/Presentation et des modules métier séparés. Une extraction ultérieure ne doit être envisagée qu’avec un besoin de déploiement ou de charge réel.

### SQLite plutôt qu’une base serveur

SQLite rend le projet immédiatement exécutable et durable localement. Le compromis est l’absence de stratégie de haute disponibilité et de concurrence multi-instance ; ces besoins sont hors exercice.

### Opérations immuables plutôt qu’event sourcing

Les opérations sont des faits métier consultables, mais l’état courant est également conservé. Cela fournit l’Historique et les corrections explicables sans imposer la reconstruction complète de l’état, des projections ou un bus d’événements.

### Minimal API plutôt que contrôleurs MVC

La surface HTTP reste courte et explicite pour quelques ressources. Si l’API devenait très large, des conventions de contrôleurs pourraient devenir utiles ; elles ne sont pas nécessaires au MVP.

### DDD sélectif

Les building blocks sont utilisés là où ils protègent une règle : Article, StockPosition, Money, Ean13 et policies. Le reste reste du code applicatif ordinaire. La conformité à DDD se mesure à la clarté des invariants et des frontières, pas au nombre de classes abstraites.

## 16. Références

- [ADR 0001 — Angular 22 et backend hexagonal modulaire](docs/adr/0001-angular-22-and-modular-hexagonal-backend.md)
- [Angular Signal Forms — vue d’ensemble](https://angular.dev/guide/forms/signals/overview)
- [Angular Signal Forms — comparaison et recommandations](https://angular.dev/guide/forms/signals/comparison)
- [ASP.NET Core Minimal APIs](https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis/overview)
- [ASP.NET Core integration tests](https://learn.microsoft.com/aspnet/core/test/integration-tests)
- [EF Core SQLite](https://learn.microsoft.com/ef/core/providers/sqlite/)
- [EF Core SQLite in-memory testing](https://learn.microsoft.com/ef/core/testing/testing-without-the-database)
