# Guide de test manuel — Token Warehouse

Parcours pas à pas pour valider à la main toutes les fonctionnalités, du
Catalogue au Dashboard. Chaque étape indique **ce qu'il faut faire** et **ce
qu'il faut voir**.

Durée : ~45 min pour le parcours complet.

---

## Phase 0 — Préparer l'environnement

1. Repartir d'une base vide :

   ```sh
   rm -f src/backend/TokenWarehouse.Api/token-warehouse.db \
     src/backend/TokenWarehouse.Api/token-warehouse.db-shm \
     src/backend/TokenWarehouse.Api/token-warehouse.db-wal
   ```

   > **Le Catalogue ne restera pas vide.** Quand la base est vide au
   > démarrage, l'API la peuple avec le jeu de démonstration Token Warehouse
   > (20 Articles, un Approvisionnement, 6 Ventes, un Inventaire et un
   > Contre-mouvement). C'est voulu : l'application ne s'ouvre jamais sur des
   > écrans vides. Les Articles que ce guide fait créer viennent **en plus** de
   > ce jeu, avec des EAN-13 qui ne le recoupent pas.

2. Terminal 1 — API :

   ```sh
   dotnet run --project src/backend/TokenWarehouse.Api/TokenWarehouse.Api.csproj --urls http://127.0.0.1:5100
   ```

3. Terminal 2 — front :

   ```sh
   npm run start:web
   ```

4. Vérifier l'API seule :

   ```sh
   curl -s http://127.0.0.1:5100/health
   ```

   **Attendu** : état de la persistance + date métier de l'Entrepôt.

5. Ouvrir <http://127.0.0.1:4200>.

   **Attendu** : redirection automatique vers `/catalogue`, barre de navigation
   avec 8 entrées : Dashboard, Catalogue, Stock, Approvisionnement, Inventaire,
   Contre-mouvement, Historique, Vente.

### Jeu de données de référence

Codes EAN-13 valides (checksum correct) utilisés dans tout le guide :

| Réf | EAN-13 | Nom | Type | Attributs | Prix HT |
| --- | --- | --- | --- | --- | --- |
| A1 | `3000000000007` | Sandwich poulet | Alimentaire | DLC 2026-12-31, À emporter **+** Sur place | 5,00 € |
| A2 | `3000000000014` | Café expresso | Alimentaire | DLC 2026-12-31, Sur place | 2,00 € |
| A3 | `3000000000021` | Yaourt périmé | Alimentaire | DLC **2020-01-01**, À emporter | 1,50 € |
| A4 | `4000000000006` | Mug logo | Non alimentaire | Packaging Neuf | 10,00 € |
| A5 | `4000000000013` | Mug ébréché | Non alimentaire | Packaging Invendable | 8,00 € |

---

## Phase 1 — Le jeu de démonstration

1. Aller sur **Catalogue**, filtre Statut sur **Tous**.

**Attendu** : 20 Articles de démonstration. Les alimentaires sont des modèles de
langage (à emporter = poids ouverts, sur place = accès API), les non
alimentaires une gamme de compute du Gaming PC au Space Datacenter.
`GPT-3.5 Turbo — fin de série` est archivé.

2. Aller sur **Dashboard**, période couvrant aujourd'hui.

**Attendu** : Stock physique 368, vendable 349, non vendable 19. Quatre Articles
non vendables : DLC dépassée (`Llama 2 7B`), archivé (`GPT-3.5 Turbo`), Packaging
invendable (`GPU Server — 8× A100`, `Space Datacenter`). Indicateurs financiers
non nuls, avec les trois taux 5,5 % / 10 % / 20 %.

3. Aller sur **Historique**.

**Attendu** : 10 faits — 1 Approvisionnement, 6 Ventes, 1 Inventaire,
1 Contre-mouvement, 1 archivage.

> Ces chiffres valent sur une base fraîchement peuplée. Ils bougent dès la
> Phase 2 ; les phases suivantes raisonnent donc en **variation**, pas en total.

---

## Phase 2 — Créer les Articles (Catalogue)

### 2.1 Article alimentaire à deux modes (A1)

1. **Catalogue** → bouton **Créer un Article**.
2. EAN-13 `3000000000007`, Type **Alimentaire**, Nom `Sandwich poulet`,
   Prix HT (€) `5,00`, DLC `2026-12-31`, cocher **À emporter** *et*
   **Sur place**.
3. Valider.

**Attendu** : redirection vers la page de détail de l'Article. Le bloc
**Prix TTC** affiche **deux quotes** :

| Contexte | Taux | TVA | TTC |
| --- | --- | --- | --- |
| À emporter | 5,5 % (11/200) | 0,28 € | **5,28 €** |
| Sur place | 10 % (1/10) | 0,50 € | **5,50 €** |

> Le TTC n'est jamais stocké : il est recalculé. L'arrondi est *away from zero*
> (27,5 → 28).

### 2.2 Article alimentaire à un seul mode (A2)

Répéter avec `3000000000014` / `Café expresso` / `2.00` / DLC `2026-12-31` /
**Sur place** uniquement. Le point est saisi ici volontairement : il vaut la
virgule.

**Attendu** : **une seule** quote, Sur place, 10 %, TTC 2,20 €.

### 2.3 Article alimentaire périmé (A3)

Répéter avec `3000000000021` / `Yaourt périmé` / `1,50` / DLC **`2020-01-01`** /
**À emporter**.

**Attendu** : l'Article est créé (une DLC passée n'empêche pas la création),
Stock vendable 0, il sera bloqué en Vente en Phase 6.

### 2.4 Articles non alimentaires (A4, A5)

1. `4000000000006` / `Mug logo` / `10,00` / Packaging **Neuf**.
2. `4000000000013` / `Mug ébréché` / `8,00` / Packaging **Invendable**.

**Attendu** : en choisissant Type = **Non alimentaire**, les champs DLC et
Modes de consommation **disparaissent** et le champ Packaging apparaît (et
inversement pour Alimentaire). Une seule quote à **20 %** (1/5) : 12,00 € pour A4.

### 2.5 Erreurs de saisie (à faire, puis annuler)

| Test | Saisie | Attendu |
| --- | --- | --- |
| Champs vides | soumettre le formulaire vide | messages sous chaque champ requis, focus sur le premier champ en erreur |
| EAN trop court | `123456789012` | « L'EAN-13 doit contenir 13 chiffres. » |
| EAN trop long | taper un 14e chiffre | le champ n'en accepte pas plus de 13 |
| Checksum invalide | `3000000000000` (13 chiffres, clé fausse) | erreur **renvoyée par le serveur**, affichée sous le champ EAN-13 |
| Prix illisible | `5,505` | « Le Prix HT doit être un montant en euros, par exemple 12,50. » |
| Doublon | recréer `3000000000007` | conflit `409` affiché sous le champ EAN-13 |

---

## Phase 3 — Liste et filtres du Catalogue

Aller sur **Catalogue**. La table liste les 5 Articles créés ci-dessus **plus**
les 20 de démonstration, avec les colonnes Article, EAN-13, Type, Statut,
Classification, Prix HT, Prix TTC, Action.

Tester les filtres un par un, puis **combinés** (ils s'intersectent) :

| Filtre | Valeur | Attendu |
| --- | --- | --- |
| Recherche | `mug` | A4 + A5 |
| Recherche | `3000000000014` | A2 seul (recherche par EAN) |
| Type | Alimentaire | A1, A2, A3 et les LLM de démonstration ; aucun compute |
| Type | Non alimentaire | A4, A5 et la gamme compute — le filtre Modes est neutralisé |
| Modes | Sur place | A1, A2 en font partie ; aucun non alimentaire |
| Packaging | Invendable | A5, `GPU Server — 8× A100`, `Space Datacenter` |
| Type=Alimentaire + Modes=À emporter | | A1 et A3 en font partie ; A2 en est absent |
| Recherche inexistante | `zzz` | « Aucun Article ne correspond à ces critères. » |

Le filtre **Statut** est sur **Actifs** par défaut ; il sera testé en 3.2.

### 3.2 Archivage / réactivation

1. Sur la ligne **A5 (Mug ébréché)**, cliquer **Archiver**.

   **Attendu** : la ligne disparaît de la vue « Actifs » ; un message de statut
   est annoncé ; le focus reste utilisable au clavier.

2. Passer le filtre Statut sur **Archivés**.

   **Attendu** : A5 apparaît, statut archivé, bouton **Réactiver**.

3. Passer sur **Tous**.

   **Attendu** : actifs et archivés réunis.

4. Laisser A5 **archivé** pour la Phase 5.

---

## Phase 4 — Détail d'un Article

1. **Catalogue** → **Détail** sur A1, ou saisir `3000000000007` dans
   **Consulter par EAN-13** puis **Consulter**.

**Attendu** : EAN-13, Type, Prix HT, Statut, DLC, Modes, Packaging, Stock
physique, Stock vendable, et les quotes TTC par contexte.

### 4.1 Modifier les attributs

1. Bloc **Attributs évolutifs** : renommer en `Sandwich poulet crudités`,
   décocher **Sur place** (garder À emporter), puis **Enregistrer les attributs**.

**Attendu** : le nom change, et le bloc Prix TTC ne montre plus **qu'une**
quote (À emporter, 5,5 %).

2. Recocher **Sur place** et enregistrer.

**Attendu** : retour à deux quotes.

### 4.2 Modifier le Prix HT

1. Bloc **Prix de référence** : passer le Prix HT à `10,00`, **Enregistrer le
   Prix HT**.

**Attendu** : TTC recalculés — À emporter 10,55 €, Sur place 11,00 €.

2. Remettre `5,00` pour la suite du guide.

### 4.3 Règle « on ne mélange pas »

Les deux formulaires sont séparés à dessein : l'API refuse un `PATCH` qui
mélange Prix HT et attributs. Vérification directe :

```sh
curl -s -X PATCH http://127.0.0.1:5100/api/articles/3000000000007 \
  -H 'content-type: application/json' \
  -d '{"priceHtCents":600,"name":"X"}'
```

**Attendu** : `400` en `application/problem+json` avec un champ `code`.

### 4.4 Archiver depuis le détail

Bouton **Archiver l'Article** / **Réactiver l'Article** : même effet qu'en
liste, le libellé bascule.

---

## Phase 5 — Approvisionnements

Aller sur **Approvisionnement**.

### 5.1 Réception unitaire

1. Ligne 1 : EAN `3000000000007`, Quantité `10`. Enregistrer.

**Attendu** : bloc **Approvisionnement engagé** avec l'identifiant d'opération,
l'horodatage, et « Ligne 1 — 3000000000007 — 10 unités — Stock physique 10 —
Stock vendable 10 ».

### 5.2 Réception en masse

1. **Ajouter une ligne** deux fois. Saisir :
   - `3000000000014` → `20`
   - `3000000000021` → `5`
   - `4000000000006` → `7`
2. Enregistrer.

**Attendu** : une seule opération, 3 lignes, avec les positions résultantes.
Noter que A3 (périmé) a un **Stock physique 5** mais un **Stock vendable 0**.

### 5.3 Une ligne fautive rejette toute la livraison

1. Deux lignes : `3000000000007` → `5`, et `9999999999994` (EAN inexistant) → `3`.
2. Enregistrer.

**Attendu** : erreur affichée, positionnée sur la ligne fautive. **Aucune**
ligne n'est appliquée : revenir sur **Stock** et vérifier que A1 est toujours
à 10, pas à 15.

3. Refaire avec une quantité invalide (`0` ou `-2`) sur une ligne : même
   comportement, priorité aux erreurs de validation.

### 5.4 Article archivé

1. Une ligne : `4000000000013` (A5, archivé en 3.2) → `4`. Enregistrer.

**Attendu** : refus `409 article_archived`, message lisible à l'écran.

2. Retourner au **Catalogue** (Statut = Archivés) et **Réactiver** A5.
3. Refaire l'approvisionnement de `4000000000013` → `4`.

**Attendu** : accepté. Stock physique 4, Stock vendable **0** (Packaging
invendable).

---

## Phase 6 — Stock courant

Aller sur **Stock**.

**Attendu** — une ligne par Article. Parmi elles, celles du jeu de ce guide :

| Article | Physique | Vendable | Non vendable | Disponibilité | Raison |
| --- | --- | --- | --- | --- | --- |
| A1 Sandwich | 10 | 10 | 0 | Disponible | — |
| A2 Café | 20 | 20 | 0 | Disponible | — |
| A3 Yaourt périmé | 5 | 0 | 5 | Non vendable | DLC dépassée |
| A4 Mug logo | 7 | 7 | 0 | Disponible | — |
| A5 Mug ébréché | 4 | 0 | 4 | Non vendable | Packaging invendable |

1. Cliquer sur une ligne pour ouvrir le **détail du Stock**, puis **Fermer le
   détail du Stock**.
2. Test de la 3ᵉ raison : archiver A4 depuis le Catalogue, revenir sur Stock.

**Attendu** : A4 passe à Stock vendable 0, raison **Archivé**, Stock physique
toujours 7. Puis **réactiver** A4 : le vendable revient à 7.

---

## Phase 7 — Ventes

Aller sur **Vente**.

### 7.1 Liste des Articles vendables

**Attendu** : seuls les Articles réellement vendables sont proposés à la vente —
A3 et A5 doivent être absents ou non sélectionnables (Stock vendable 0). La
colonne **Devis TTC** affiche le prix TTC.

### 7.2 Recherche

Saisir `sandwich`, puis `3000000000014` dans **Rechercher par nom ou EAN-13**.

**Attendu** : filtrage correct dans les deux cas ; « Aucun Article ne
correspond à cette recherche. » sur une saisie absurde.

### 7.3 Vente avec Contexte obligatoire (A1)

1. Sélectionner **A1** (deux modes).

**Attendu** : deux boutons radio **Contexte de Vente** : À emporter / Sur place.

2. Sans choisir de contexte, saisir Quantité `2` et valider.

**Attendu** : refus, le Contexte est exigé.

3. Choisir **À emporter**.

**Attendu** : le **Devis tarifaire serveur** s'actualise — taux 5,5 %, prix TTC
unitaire 5,28 €.

4. Quantité `2`, valider.

**Attendu** : bloc **Vente engagée** — identifiant d'opération, horodatage UTC,
Quantité 2, Prix HT unitaire 5,00 €, Taux 5,5 %, Montant HT 10,00 €,
TVA 0,55 €, Montant TTC 10,55 €, Stock physique résultant **8**, Stock vendable
résultant 8.

> La TVA de la Vente est calculée sur le **montant total** (1000 × 11/200 = 55
> centimes), pas 2 × 28. C'est voulu : le snapshot financier est figé à la
> Vente, et les centimes restent la seule unité de calcul sous l'affichage.

### 7.4 Vente sans Contexte (A4, non alimentaire)

1. Sélectionner **A4 Mug logo**, Quantité `1`, valider.

**Attendu** : mention « Aucun Contexte de Vente — TVA non alimentaire. », taux
20 %, Montant HT 10,00 €, TVA 2,00 €, TTC 12,00 €, Stock résultant 6.

### 7.5 Vente à un seul mode (A2)

Sélectionner **A2 Café expresso**, Quantité `5`.

**Attendu** : contexte Sur place appliqué, 10 %, HT 10,00 €, TVA 1,00 €,
TTC 11,00 €, Stock résultant 15.

### 7.6 Vente supérieure au Stock vendable

Sélectionner **A2**, Quantité `999`, valider.

**Attendu** : refus explicite. Une position ne peut pas devenir négative.
Vérifier sur **Stock** que A2 est toujours à 15.

### 7.7 Quantité invalide

Quantité `0`, puis `-1`, puis `1,5`.

**Attendu** : refus côté formulaire dans les trois cas.

---

## Phase 8 — Inventaires

Aller sur **Inventaire**.

### 8.1 Écart négatif (perte / vol)

1. Ligne 1 : EAN `3000000000007` (l'autocomplétion propose les Articles connus,
   avec leur nom).

**Attendu** : sous le champ, l'indice « Sandwich poulet — Stock physique
connu : 8 unités ».

2. Quantité comptée `6`. Enregistrer.

**Attendu** : bloc **Inventaire enregistré** — Stock physique précédent 8,
Quantité comptée 6, **Écart d'inventaire −2**, Nouvelle base physique 6,
Stock vendable 6, Disponibilité Disponible, Timestamp UTC.

### 8.2 Écart positif et comptage multiple

1. **Ajouter une ligne**. Saisir :
   - `3000000000014` → compté `17` (connu : 15) → **écart +2**
   - `4000000000006` → compté `6` (connu : 6) → **écart 0**
2. Enregistrer.

**Attendu** : un reçu, une section par ligne, écarts `+2` et `0` affichés
distinctement. L'écart n'est **jamais** silencieux.

### 8.3 Erreurs

| Test | Attendu |
| --- | --- |
| EAN inconnu `9999999999994` | erreur sur la ligne, rien n'est appliqué |
| Quantité comptée négative | refus |
| Deux lignes sur le **même** EAN | refus — un seul Article par ligne |

### 8.4 Persistance de saisie

Remplir une ligne **sans** valider, naviguer vers Stock, puis revenir sur
Inventaire.

**Attendu** : la saisie en cours est conservée, et le dernier Inventaire
enregistré est relu (message « Relecture du dernier Inventaire… » puis reçu).

Cliquer sur **Voir tous les Inventaires dans l'Historique** → arrive sur
`/stock/historique`.

---

## Phase 9 — Contre-mouvements (corrections)

Aller sur **Contre-mouvement**.

1. Cliquer **Charger les Opérations corrigeables**.

**Attendu** : la liste contient les Approvisionnements, Ventes et Inventaires
déjà enregistrés — **pas** les Contre-mouvements eux-mêmes.

### 9.1 Corriger un Approvisionnement

1. Choisir l'Approvisionnement de A2 (`3000000000014`, +20).

**Attendu** : bloc **Source** avec le Type, le Timestamp UTC et l'effet Stock
par ligne.

2. Laisser la **Justification** vide et valider.

**Attendu** : refus — la justification est obligatoire.

3. Saisir `Erreur de saisie : livraison comptée deux fois.` puis valider.

**Attendu** : bloc **Contre-mouvement enregistré** — Correction, Source,
Justification, Timestamp, **Effet source** vs **Effet inverse**, et la nouvelle
position (Stock physique, vendable, Disponibilité, Raison).

### 9.2 Corriger une Vente (inversion financière)

1. Recharger les sources, choisir la **Vente** de A1 (2 unités, à emporter).
2. Justification `Vente annulée par le client.` Valider.

**Attendu** : en plus de l'effet Stock inverse, un bloc **Vente source** avec
le Contexte historique, le Taux historique et les montants **inversés**
(HT −10,00 €, TVA −0,55 €, TTC −10,55 €). Le snapshot d'origine n'est pas
modifié.

### 9.3 Non-corrigeable

Recharger les sources.

**Attendu** : les Contre-mouvements créés en 9.1 et 9.2 **n'apparaissent pas**
dans la liste.

---

## Phase 10 — Historique

Aller sur **Historique**.

1. **Historique global**.

**Attendu** : tous les faits, du **plus récent au plus ancien**, mélangeant
mouvements de stock (Approvisionnement, Vente, Inventaire, Contre-mouvement) et
faits de **cycle de vie** (création, archivage, réactivation, changement de prix,
changement d'attributs).

2. Vérifier le contenu par type de fait :

| Fait | Doit afficher |
| --- | --- |
| Approvisionnement | Quantité utile, Effet Stock, Stock physique précédent → résultant, lignes |
| Vente | Prix HT unitaire historique, Contexte, Taux, Montant HT / TVA / TTC historiques |
| Inventaire | Stock physique précédent, Quantité comptée, **Écart**, Stock résultant |
| Contre-mouvement | Source, Justification, inversions financières HT / TVA / TTC |
| Cycle de vie | libellé du fait (archivage, prix, attributs…) |

3. L'opération corrigée en Phase 9 doit porter la mention **Corrigé par** vers
   son Contre-mouvement.

4. **Filtrer par EAN-13** : saisir `3000000000007`, filtrer.

**Attendu** : uniquement les faits de A1. Saisir un EAN inconnu →
« Aucun fait historique ne correspond à cette requête. »

5. Revenir à l'**Historique global**.

> Aucun fait n'est modifiable : l'Historique est en lecture seule.

---

## Phase 11 — Dashboard

Aller sur **Dashboard**.

1. Régler la période **Du** / **Au** pour couvrir aujourd'hui, valider.

**Attendu** :
- **Stock physique / vendable / non vendable** cohérents avec l'écran Stock
  (recouper les deux écrans ligne à ligne).
- **Ruptures actives** : les Articles à 0 (sinon « Aucune rupture active. »).
- **Articles non vendables** : A3 (DLC dépassée) et A5 (Packaging invendable)
  parmi ceux du jeu de démonstration, chacun avec sa raison.
- **Indicateurs financiers** : Chiffre d'affaires HT, TTC et TVA collectée, en
  euros, calculés sur les **Ventes validées** — donc nets des Contre-mouvements
  de la Phase 9.
- **TVA par taux** : une ligne par taux réellement utilisé (5,5 %, 10 %, 20 %),
  avec Montant HT / TVA / TTC.
- **Positions courantes par Article**.

2. Filtrer **Type d'Article = Alimentaire**.

**Attendu** : A4 et A5 disparaissent des positions ; les indicateurs financiers
sont recalculés sur la seule sélection.

3. Filtrer **Mode = À emporter**, puis **Packaging = Invendable** (avec Type =
   Non alimentaire).

**Attendu** : intersections cohérentes ; « Aucun Article ne correspond aux
sélections. » sur une combinaison vide.

4. Choisir une période **antérieure** à aujourd'hui (ex. mois dernier).

**Attendu** : indicateurs financiers à 0 €, sans erreur.

5. Choisir **Du** postérieur à **Au**.

**Attendu** : refus lisible, pas de page cassée.

---

## Phase 12 — Robustesse et accessibilité

1. **Clavier seul** : parcourir Catalogue → Créer un Article → soumettre en
   erreur, uniquement au `Tab` / `Entrée` / `Espace`.

   **Attendu** : tout est atteignable, le focus part sur le premier champ en
   erreur, les titres de page reçoivent le focus à la navigation.

2. **Lecteur d'écran / zones live** : après un archivage, une vente ou un
   inventaire, un message de statut est annoncé (`role="status"` /
   `role="alert"`).

3. **API coupée** : arrêter le terminal 1, recharger le Catalogue.

   **Attendu** : message d'erreur et bouton **Réessayer** ; relancer l'API,
   cliquer **Réessayer**, la liste revient.

4. **Rechargement de page** (`F5`) sur chaque route : `/catalogue`,
   `/catalogue/3000000000007`, `/stock`, `/stock/inventaires`, `/ventes`,
   `/stock/historique`.

   **Attendu** : aucune 404, la page se recharge sur elle-même.

5. **Route inconnue** : ouvrir `/nimporte-quoi`.

   **Attendu** : redirection vers le Dashboard.

6. **Contrat d'erreur** : vérifier le `problem+json`.

   ```sh
   curl -s -i http://127.0.0.1:5100/api/articles/0000000000000
   ```

   **Attendu** : `404`, `content-type: application/problem+json`, champ `code`.

---

## Récapitulatif de couverture

| Fonctionnalité | Phase |
| --- | --- |
| Création d'Articles, deux classifications, champs conditionnels | 2 |
| EAN-13 (13 chiffres, checksum, unicité, conflit 409) | 2.5 |
| Quotes de prix TTC par contexte, 5,5 % / 10 % / 20 % | 2, 4 |
| Filtres et recherche du Catalogue | 3 |
| Archivage réversible (liste et détail) | 3.2, 4.4 |
| Modification des attributs et du Prix HT (non mélangeables) | 4 |
| Approvisionnement unitaire et en masse, rejet atomique | 5 |
| Refus d'approvisionner un Article archivé | 5.4 |
| Stock physique vs vendable, 3 raisons de blocage | 6 |
| Ventes, contexte obligatoire, snapshot financier immuable | 7 |
| Stock jamais négatif | 7.6 |
| Inventaires, écarts +/−/0, comptage multiligne | 8 |
| Contre-mouvements, justification, inversion financière | 9 |
| Historique fusionné, filtré, immuable, lien « Corrigé par » | 10 |
| Dashboard : période, filtres, flux, indicateurs par taux | 11 |
| Accessibilité clavier, résilience réseau, contrat d'erreur | 12 |
