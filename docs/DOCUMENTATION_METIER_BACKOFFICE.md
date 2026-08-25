# Documentation métier — Back-office Token Warehouse

**Version analysée :** 23 août 2026  
**Périmètre :** application présente dans le dépôt et Project GitHub `QServicesEntreprise / Token Warehouse #1`  
**Utilisateur métier principal :** Gestionnaire  
**Entrepôt :** un entrepôt unique

## 1. Finalité du back-office

Token Warehouse permet au Gestionnaire de maintenir un catalogue d’Articles, de suivre les quantités physiques et vendables de l’entrepôt, d’enregistrer les mouvements de stock, de simuler des Ventes et de piloter l’activité par des indicateurs.

Le back-office est une page unique organisée par navigation interne :

`Dashboard` → `Stock` → `Vente` → `Approvisionnement` → `Inventaire` → `Contre-mouvement` → `Historique` → `Catalogue`

Le périmètre livré ne prévoit ni comptes utilisateurs, ni rôles, ni multi-entrepôts. Le Gestionnaire est donc l’acteur métier unique du MVP.

## 2. Lecture du kanban projet

Le Project GitHub est privé ; sa lecture a été faite via l’accès GitHub authentifié. Au 23 août 2026, les **40 éléments** du Project sont au statut **Done**.

| Bloc du kanban | Fonction métier couverte | Éléments |
|---|---|---|
| Wayfinder | Décisions de produit, vocabulaire, règles de prix/stock, architecture et handoff | Issues #1 à #12 |
| Epic Catalogue | Maintenir un catalogue d’Articles fiables | #13 |
| Epic Stock | Fiabiliser et tracer le stock | #14 |
| Epic Ventes | Simuler les Ventes et sécuriser la vendabilité | #15 |
| Epic Pilotage | Suivre l’entrepôt par les indicateurs | #16 |
| Catalogue | Création, consultation, prix TTC, recherche, cycle de vie et attributs | #17 à #21 |
| Stock et Historique | Positions, approvisionnements, inventaires, corrections, Historique | #22 à #28 |
| Contrats internes | Contrat Stock et socle exécutable/testable | #29 et #40 |
| Ventes | Vente, contexte, vendabilité, snapshot financier, correction et exposition | #30 à #34 |
| Pilotage | Positions, filtres, flux, finance et Dashboard accessible | #35 à #39 |

Les issues #29 et #40 sont des éléments techniques de soutien ; elles ne constituent pas des écrans métier supplémentaires.

## 3. Objets métier

| Objet | Définition | Particularités |
|---|---|---|
| Article | Référence du catalogue et unité suivie en stock | Identifié par un EAN-13 unique et immuable |
| Article alimentaire | Article soumis à une DLC et à un ou deux modes de consommation | À emporter, sur place, ou les deux |
| Article non alimentaire | Article soumis à un état de Packaging | Neuf, Reconditionné ou Invendable |
| Prix HT | Prix de référence avant TVA | Saisi en centimes ; modifiable seulement sur un Article actif |
| Prix TTC | Prix HT augmenté de la TVA applicable | Calculé, arrondi au centime et non persisté comme donnée de référence |
| Stock physique | Quantité considérée comme présente dans l’entrepôt | Ne peut jamais être négative |
| Stock vendable | Quantité pouvant être proposée à la Vente | Peut être inférieure au Stock physique |
| Opération de stock | Mouvement validé qui explique une évolution de stock | Approvisionnement, Inventaire, Vente ou Contre-mouvement |
| Historique | Suite immuable des faits métier | Accessible globalement ou par Article |
| Dashboard | Lecture synthétique de l’état courant et des mouvements | Combine Stock, Catalogue, Ventes et finance historique |

Dans les données de démonstration, les Articles alimentaires représentent des modèles de langage et les Articles non alimentaires des infrastructures de calcul. Cette mise en scène vient du brief créatif ; elle ne modifie pas les règles de gestion.

## 4. Fonctionnalités du Catalogue

### 4.1 Créer un Article

Le Gestionnaire saisit :

- la référence EAN-13 ;
- le type `Alimentaire` ou `Non alimentaire` ;
- le nom ;
- le Prix HT en centimes ;
- les attributs propres au type.

Pour un Article alimentaire, la DLC et au moins un mode de consommation sont obligatoires. Pour un Article non alimentaire, le Packaging est obligatoire.

Le système refuse :

- un EAN-13 qui ne contient pas 13 chiffres ou dont le checksum est invalide ;
- un EAN-13 déjà utilisé ;
- un nom absent ;
- un Prix HT absent ;
- une DLC invalide ou manquante pour un Article alimentaire ;
- des modes de consommation inconnus ou dupliqués ;
- un Packaging absent ou inconnu pour un Article non alimentaire ;
- les attributs d’une autre classification, par exemple une DLC sur un Article non alimentaire.

Une création valide rend l’Article actif, initialise son stock à zéro et affiche immédiatement sa fiche détaillée.

### 4.2 Consulter et rechercher le Catalogue

Le Gestionnaire peut :

- rechercher par nom ou par EAN-13 ;
- afficher les Articles actifs, archivés ou tous ;
- filtrer par type ;
- filtrer un Article alimentaire par mode de consommation ;
- filtrer un Article non alimentaire par Packaging ;
- ouvrir la fiche d’un Article depuis la liste.

Les filtres sont combinés par intersection (`ET`). Une combinaison sans résultat retourne une liste vide, sans revenir automatiquement à une recherche plus large.

La fiche expose l’identité, la classification, le statut, le Prix HT, les attributs propres au type, les Prix TTC par contexte et le Stock physique/vendable courant.

### 4.3 Calculer les Prix TTC

Le Prix HT est la donnée de référence. Les taux métier sont fixes dans le MVP :

| Situation | Contexte | TVA |
|---|---|---:|
| Alimentaire à emporter | `takeaway` | 5,5 % |
| Alimentaire sur place | `onsite` | 10 % |
| Non alimentaire | aucun contexte | 20 % |

Le Prix TTC est calculé à partir du Prix HT et arrondi au centime. Un Article alimentaire disponible dans les deux modes affiche deux devis TTC ; un Article à mode unique affiche un seul devis ; un Article non alimentaire affiche le devis à 20 %.

Le navigateur affiche le résultat fourni par le serveur et ne décide pas lui-même du taux de TVA.

### 4.4 Modifier un Article actif

Deux modifications séparées sont disponibles sur la fiche :

1. **Prix HT** : modification du prix de référence en centimes.
2. **Attributs évolutifs** :
   - nom, DLC et modes pour un Article alimentaire ;
   - nom et Packaging pour un Article non alimentaire.

Un Article archivé doit être réactivé avant toute modification. Le type et l’EAN-13 ne sont jamais modifiables ; une erreur de classification se corrige par archivage puis création d’une nouvelle référence.

Une modification de DLC ou de Packaging recalcule immédiatement la vendabilité courante. Les changements d’attributs sont inscrits dans l’Historique avec la valeur précédente et la nouvelle valeur.

Le MVP ne crée pas d’Historique dédié des changements de Prix HT. En revanche, le Prix HT utilisé par une Vente déjà validée reste conservé dans le snapshot financier de cette Vente.

### 4.5 Archiver et réactiver

L’archivage retire l’Article du Catalogue actif sans suppression physique. Il conserve son identité, son stock physique et son Historique.

Un Article archivé :

- n’accepte plus d’Approvisionnement ;
- n’accepte plus de Vente ;
- reste consultable dans les vues archivées ou toutes ;
- devient non vendable lorsqu’une quantité physique subsiste ;
- peut encore faire l’objet d’un Inventaire ou d’un Contre-mouvement.

La réactivation remet l’Article dans le Catalogue actif et réévalue sa vendabilité selon ses attributs actuels et la date de l’Entrepôt.

## 5. Fonctionnalités de Stock

### 5.1 Consulter le Stock courant

La vue Stock affiche une ligne par Article du Catalogue, y compris les Articles archivés et ceux qui n’ont encore aucune position persistée.

Pour chaque Article, le Gestionnaire voit :

- le nom et l’EAN-13 ;
- le Stock physique ;
- le Stock vendable ;
- la disponibilité ;
- la raison d’une non-vendabilité ;
- un détail rechargé par EAN-13.

Les états métier sont :

| État | Condition |
|---|---|
| Disponible | Stock physique strictement positif et aucune règle bloquante |
| Rupture | Stock physique nul |
| Non vendable | Stock physique positif et Stock vendable nul |

Les raisons de blocage possibles sont `Article archivé`, `DLC dépassée` et `Packaging invendable`. La quantité non vendable est toujours `Stock physique - Stock vendable`.

La DLC reste valable jusqu’à sa date incluse. L’Article devient non vendable le lendemain de la DLC selon le calendrier de l’Entrepôt.

### 5.2 Enregistrer un Approvisionnement unitaire

Le Gestionnaire saisit un EAN-13 et une quantité entière strictement positive. Le système :

1. vérifie que l’Article existe ;
2. refuse un Article archivé ;
3. ajoute la quantité au Stock physique ;
4. recalcule le Stock vendable ;
5. enregistre une Opération immuable ;
6. retourne la position engagée.

Une quantité invalide, un Article inconnu ou un Article archivé produit une erreur ciblée et ne modifie pas le stock.

### 5.3 Enregistrer un Approvisionnement en masse

Le Gestionnaire peut ajouter plusieurs lignes EAN-13/quantité. Toutes les lignes sont contrôlées avant application.

Règles :

- la collection doit contenir au moins une ligne ;
- chaque quantité doit être strictement positive ;
- un Article ne peut apparaître qu’une seule fois ;
- toutes les références doivent être valides et acceptées ;
- l’opération est appliquée en totalité ou rejetée en totalité ;
- une seule Opération de stock regroupe les lignes, dans leur ordre de saisie.

Une erreur sur une ligne laisse les autres lignes inchangées.

### 5.4 Réconcilier le Stock par Inventaire

Le Gestionnaire saisit la quantité réellement comptée. La quantité comptée peut être zéro.

Le système présente et conserve :

- le Stock physique précédent ;
- la quantité comptée ;
- l’Écart d’inventaire : `quantité comptée - stock précédent` ;
- la nouvelle base de Stock physique ;
- le Stock vendable et la disponibilité résultants.

Un Inventaire n’efface pas les opérations antérieures. Il établit une nouvelle base de référence tout en conservant le fait d’inventaire dans l’Historique.

Un Article archivé peut être inventorié, notamment pour conserver la réalité physique d’un stock résiduel.

### 5.5 Saisir un Inventaire en masse

Le Gestionnaire peut saisir plusieurs lignes dans un même Inventaire. Les lignes doivent être non vides, valides et porter des EAN-13 distincts.

L’Inventaire en masse est atomique : si une référence est inconnue, dupliquée ou invalide, aucune ligne n’est appliquée. Le résultat expose, pour chaque ligne, le précédent, le comptage, l’écart, la nouvelle base et la position vendable.

Le dernier identifiant d’Inventaire est conservé dans la session du navigateur pour permettre une relecture après rechargement de la page.

### 5.6 Corriger une Opération par Contre-mouvement

Le Gestionnaire charge la liste des Opérations corrigeables, choisit une source et saisit une justification obligatoire.

Les sources autorisées sont :

- Approvisionnement ;
- Inventaire ;
- Vente.

Un Contre-mouvement :

- ne modifie ni ne supprime l’Opération source ;
- crée un nouveau fait historisé ;
- applique l’effet inverse de chaque ligne source ;
- est refusé si le résultat rendrait le Stock physique négatif ;
- ne peut être effectué qu’une seule fois pour une source ;
- ne peut pas corriger un autre Contre-mouvement ;
- doit être postérieur à la source.

Lorsqu’il corrige une Vente, il inverse également les montants financiers historiques HT, TVA et TTC issus du snapshot de cette Vente.

## 6. Fonctionnalités de Vente simulée

### 6.1 Rechercher l’Article à vendre

Le Gestionnaire recherche un Article actif par nom ou EAN-13. La liste de Vente affiche le Prix HT, le Stock physique, le Stock vendable, la disponibilité et les devis TTC.

Les Articles archivés ne sont pas proposés dans cette recherche.

### 6.2 Préparer une Vente

Le Gestionnaire sélectionne un Article puis saisit une quantité entière strictement positive.

Le Contexte de Vente est déterminé ainsi :

| Article | Saisie attendue |
|---|---|
| Alimentaire avec un seul mode | Contexte déduit automatiquement |
| Alimentaire avec deux modes | Le Gestionnaire choisit `À emporter` ou `Sur place` |
| Non alimentaire | Aucun contexte ; TVA 20 % |

Le devis tarifaire serveur permet de vérifier le taux et le Prix TTC unitaire avant validation. Une Vente avec deux modes sans contexte est refusée ; un contexte incompatible ou appliqué à un Article non alimentaire est refusé.

### 6.3 Valider une Vente

À la validation, le serveur relit l’Article et le Stock, revalide les règles et engage dans une même transaction :

- l’Opération de Vente ;
- la diminution du Stock physique ;
- la nouvelle position de stock ;
- le snapshot financier.

La Vente est refusée si :

- l’Article est inconnu, archivé ou non vendable ;
- la DLC est dépassée ;
- le Packaging est Invendable ;
- la quantité demandée dépasse le Stock vendable courant ;
- la position a changé pendant la validation ;
- le contexte de Vente est manquant ou incompatible.

La réponse affiche l’identifiant, l’horodatage UTC, l’EAN-13, la quantité, le Prix HT unitaire, le taux de TVA, les montants HT/TVA/TTC et le Stock résultant.

### 6.4 Garantir l’historique financier

Une Vente acceptée fige au moment de sa validation :

- le Prix HT unitaire ;
- le Contexte de Vente ;
- le Taux de TVA ;
- le Montant HT ;
- la TVA ;
- le Montant TTC ;
- la référence EAN-13, la quantité, l’identifiant et l’horodatage.

Une modification ultérieure du Prix HT, de la DLC, du Packaging, de l’archivage ou de la réactivation ne réécrit jamais cette Vente. Une nouvelle lecture ou un rechargement retrouve les mêmes montants.

Le calcul financier est effectué en centimes :

`Montant HT = Prix HT unitaire × quantité`  
`TVA = arrondi au centime du Montant HT × taux`  
`Montant TTC = Montant HT + TVA`

Le MVP ne permet ni modification ni suppression directe d’une Vente. La correction métier passe par un Contre-mouvement.

## 7. Fonctionnalités d’Historique

### 7.1 Historique global

Le Gestionnaire peut charger tous les faits enregistrés, présentés du plus récent au plus ancien dans l’interface.

Les types visibles sont :

- Approvisionnement ;
- Inventaire ;
- Vente Stock ;
- Contre-mouvement ;
- Archivage Catalogue ;
- Réactivation Catalogue ;
- Changement de DLC ;
- Changement de Packaging ;
- Changement d’attribut Catalogue.

Chaque entrée peut afficher l’identifiant, l’horodatage, les Articles concernés, les quantités, les effets Stock, les écarts d’inventaire, les lignes d’une opération en masse, la source et la justification d’une correction, ainsi que les données financières historiques.

### 7.2 Historique d’un Article

Depuis une fiche Article, le Gestionnaire peut charger l’Historique de l’EAN-13 courant. Il retrouve les opérations Stock et les changements de cycle de vie ou d’attributs associés à cette référence.

L’Historique est en lecture seule. Une erreur de lecture est signalée sans afficher de données partielles ni de détail technique interne.

## 8. Fonctionnalités du Dashboard

### 8.1 Période et filtres

Le Dashboard est chargé initialement sur le mois courant du calendrier de l’Entrepôt. Le Gestionnaire peut choisir :

- une date de début et une date de fin inclusives ;
- le type Alimentaire ou Non alimentaire ;
- le mode À emporter ou Sur place ;
- le Packaging Neuf, Reconditionné ou Invendable.

Les filtres sont combinés par intersection. Une sélection impossible retourne un Dashboard vide, jamais l’ensemble des Articles.

La période filtre les flux et les indicateurs financiers. Elle ne reconstitue pas un Stock historique : les positions affichées restent les positions courantes au moment de la lecture.

### 8.2 KPI de Stock

Pour la sélection courante, le Dashboard affiche :

- Stock physique total ;
- Stock vendable total ;
- Stock non vendable total.

Il fournit également un tableau par Article avec le type, le cycle de vie, les trois quantités, la disponibilité et la raison de blocage.

### 8.3 Alertes opérationnelles

Deux alertes sont distinguées :

- **Ruptures actives** : Articles actifs dont le Stock physique et le Stock vendable sont nuls ;
- **Articles non vendables** : Articles possédant une quantité physique positive mais aucun Stock vendable, avec la raison affichée.

Les liens d’alerte ramènent à la ligne correspondante du tableau Dashboard.

### 8.4 Flux quotidiens

Le Dashboard présente, pour chaque jour de la période :

- les quantités reçues par Approvisionnement ;
- les quantités sorties par Vente.

Les journées sans activité restent présentes avec zéro. Le classement des opérations utilise le calendrier de l’Entrepôt et non une conversion arbitraire du navigateur.

### 8.5 Indicateurs financiers

Pour les Ventes validées de la période et de la sélection courante, le Dashboard affiche :

- Chiffre d’affaires HT ;
- Chiffre d’affaires TTC ;
- TVA collectée ;
- détail par taux de TVA : montant HT, TVA et montant TTC.

Un Contre-mouvement financier est pris en compte à la date de la correction avec des montants négatifs. Les indicateurs utilisent les snapshots historiques et non le Prix HT courant du Catalogue.

Dans l’interface actuelle, les flux et les indicateurs sont rendus sous forme de tableaux accessibles ; aucune bibliothèque de graphiques n’est nécessaire au MVP.

## 9. Parcours métier de référence

### Parcours nominal

1. Créer un Article valide.
2. Le retrouver dans le Catalogue et vérifier ses devis TTC.
3. Enregistrer une réception unitaire ou en masse.
4. Contrôler le Stock physique et le Stock vendable.
5. Réaliser éventuellement un Inventaire pour établir une nouvelle base.
6. Rechercher l’Article dans le parcours Vente.
7. Choisir le Contexte de Vente si nécessaire et valider une quantité disponible.
8. Vérifier le reçu de Vente et les montants financiers.
9. Consulter l’Historique global ou par Article.
10. Ouvrir le Dashboard pour suivre les positions, flux et montants.

### Parcours de correction

1. Charger les Opérations corrigeables.
2. Choisir la source.
3. Saisir une justification.
4. Valider le Contre-mouvement.
5. Vérifier les positions résultantes.
6. Contrôler dans l’Historique le lien source/correction.
7. Vérifier, pour une Vente, l’inversion financière dans le Dashboard.

## 10. Règles transverses de fiabilité

- Le serveur est l’autorité pour la vendabilité, le calcul de TVA, les montants et les positions.
- Les montants sont manipulés en centimes ; les flottants ne servent pas aux calculs financiers.
- Les opérations engagées sont immédiates et immuables.
- Les opérations en masse sont atomiques : aucune application partielle.
- Les lectures de Stock, Historique et Dashboard sont sans effet d’écriture.
- Les erreurs sont structurées par champ ou par code métier ; les saisies restent disponibles pour correction dans l’interface.
- Les états de chargement, succès, vide, erreur et nouvelle tentative sont visibles et annoncés de façon accessible.
- L’EAN-13 conserve ses zéros initiaux et reste la référence externe de l’Article.
- Aucune suppression physique d’Article ou d’Opération n’est utilisée pour préserver l’explicabilité.

## 11. Annexe — surface fonctionnelle de l’API

Cette annexe sert de contrat de liaison entre les écrans du back-office et le serveur.

| Méthode | Route | Capacité |
|---|---|---|
| `GET` | `/health` | État de disponibilité, date de l’Entrepôt et mois courant |
| `POST` | `/api/articles` | Créer un Article |
| `GET` | `/api/articles` | Rechercher et filtrer le Catalogue |
| `GET` | `/api/articles/{ean13}` | Consulter une fiche Article avec ses devis et son stock |
| `PATCH` | `/api/articles/{ean13}` | Modifier le Prix HT ou les attributs évolutifs |
| `POST` | `/api/articles/{ean13}/archive` | Archiver |
| `POST` | `/api/articles/{ean13}/reactivate` | Réactiver |
| `GET` | `/api/stock` | Lire toutes les positions courantes |
| `GET` | `/api/stock/{ean13}` | Lire une position détaillée |
| `POST` | `/api/supplies` | Enregistrer un Approvisionnement unitaire |
| `POST` | `/api/supplies/bulk` | Enregistrer un Approvisionnement en masse atomique |
| `POST` | `/api/inventories` | Enregistrer un Inventaire unitaire |
| `POST` | `/api/inventories/bulk` | Enregistrer un Inventaire en masse atomique |
| `GET` | `/api/inventories/{id}` | Relire un Inventaire engagé |
| `GET` | `/api/sales/articles` | Rechercher les Articles actifs vendables ou à contrôler |
| `POST` | `/api/sales` | Enregistrer une Vente |
| `GET` | `/api/sales/{operationId}` | Relire le résultat financier et Stock d’une Vente |
| `GET` | `/api/stock/counter-movements/sources` | Lister les sources corrigeables |
| `POST` | `/api/stock/counter-movements` | Enregistrer un Contre-mouvement |
| `GET` | `/api/history` | Lire l’Historique global ou filtré par EAN-13 |
| `GET` | `/api/dashboard` | Lire les KPI, alertes, flux et indicateurs financiers |

Les erreurs utilisent `application/problem+json` : `400` pour une saisie invalide, `404` pour une référence ou opération inconnue, `409` pour un conflit métier et `500` pour une panne interne assainie.

## 12. Limites explicites du MVP

Les éléments suivants ne sont pas des fonctionnalités du back-office actuel :

- authentification, rôles et permissions ;
- plusieurs entrepôts ou transferts entre sites ;
- fournisseurs, commandes d’achat, clients, paiement et facturation ;
- scan matériel, export, notifications ou seuils configurables ;
- édition ou suppression directe d’une Vente ou d’une opération engagée ;
- suppression physique d’un Article ;
- Historique séparé des Prix HT ;
- pagination ou moteur d’analytics au-delà des indicateurs du Dashboard ;
- intégrations externes.

## 13. Sources et traçabilité

- Énoncé fonctionnel de l’exercice (non redistribué par le dépôt)
- [Glossaire et invariants métier](../CONTEXT.md)
- [README et surface de lancement/API](../README.md)
- Brief créatif Token Warehouse (source non distribuée)
- [Interface principale du back-office](../src/web/app/app.ts)
- [Composant Dashboard](../src/web/features/dashboard/presentation/dashboard-page.ts)
- [Règles métier Article](../src/backend/TokenWarehouse.Domain/Article.cs)
- [Règles métier Stock et vendabilité](../src/backend/TokenWarehouse.Domain/Stock.cs)
- [Politique de prix et TVA](../src/backend/TokenWarehouse.Domain/Pricing.cs)
- [Application des Ventes](../src/backend/TokenWarehouse.Application/Sale.cs)
- [Application du Dashboard](../src/backend/TokenWarehouse.Application/Dashboard.cs)
- [Project GitHub #1](https://github.com/users/QServicesEntreprise/projects/1/views/1)

## 14. État de vérification du dépôt au 23 août 2026

- Build Angular : réussi.
- Tests web : **40 réussis**.
- Tests d’architecture : **6 réussis**.
- Build .NET : réussi, 0 avertissement et 0 erreur.
- Tests .NET : **313 réussis**.
- Tests E2E Playwright : **35 réussis**.

La commande globale a d’abord rencontré un port `4200` déjà occupé ; après libération naturelle du processus, la suite E2E a été relancée séparément et a terminé avec 35 tests réussis.
