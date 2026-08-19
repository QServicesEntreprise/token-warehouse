# Token Warehouse

Vocabulaire métier du back-office de gestion de stock d’un entrepôt unique.

## Acteur et périmètre

**Gestionnaire** : personne qui pilote le catalogue, les mouvements de stock, les inventaires et les ventes simulées.

**Entrepôt** : unique lieu physique dont Token Warehouse suit les quantités.

## Catalogue et opérations

**Article** : unité identifiable du catalogue et du stock, classée comme alimentaire ou non alimentaire par une référence EAN-13.

**Référence EAN-13** : identifiant numérique valide et unique d’un Article dans l’Entrepôt ; elle ne change pas au cours de la vie de l’Article.

**Article alimentaire** : Article soumis à une DLC et à un mode de consommation : à emporter, sur place, ou les deux.

**Article non alimentaire** : Article soumis à un niveau de packaging : Neuf, Reconditionné, ou Invendable.

**DLC** : date limite de consommation portée par un Article alimentaire et représentant sa limite de fraîcheur ou d’obsolescence métier.

**Packaging** : état commercial d’un Article non alimentaire, parmi Neuf, Reconditionné et Invendable.

**Article non vendable** : Article présent dans l’Entrepôt mais dont le Stock vendable est nul en raison de sa DLC dépassée, de son Packaging Invendable ou de son archivage.

**Article en rupture** : Article actif dont le Stock physique et le Stock vendable sont nuls ; aucune quantité de cette référence n’est présente dans l’Entrepôt.

**Article archivé** : Article retiré du catalogue actif sans suppression de son identité, de son Stock physique ou de son Historique.

**Prix HT** : prix de référence d’un Article avant application de la TVA.

**TVA** : taxe appliquée au Prix HT selon un Taux de TVA.

**Taux de TVA** : pourcentage applicable à une Vente : 5,5 % pour l’alimentaire à emporter, 10 % pour l’alimentaire sur place et 20 % pour le non alimentaire.

**Chiffre d’affaires HT** : montant cumulé des Ventes avant application de la TVA sur une période de pilotage.

**Chiffre d’affaires TTC** : montant cumulé des Ventes après application de la TVA sur une période de pilotage.

**TVA collectée** : montant de TVA associé aux Ventes simulées, présenté par Taux de TVA applicable.

**Prix TTC** : prix calculé à partir du Prix HT et de la TVA applicable, exprimé en euros et arrondi au centime.

**Contexte de Vente** : mode de consommation choisi pour une Vente d’un Article alimentaire : à emporter ou sur place.

**Contexte tarifaire de Vente** : Prix HT unitaire, Taux de TVA et Contexte de Vente applicables au moment de la validation d’une Vente.

**Montants d’une Vente** : montant HT, montant de TVA et montant TTC résultant de la quantité vendue et de son Contexte tarifaire de Vente.

**Opération de stock** : action métier validée qui modifie ou réconcilie la quantité d’un ou plusieurs Articles dans l’Entrepôt.

**Opération en masse** : Opération de stock portant sur plusieurs Articles et validée en totalité ou pas du tout.

**Approvisionnement** : Opération de stock qui fait entrer une quantité positive d’Articles dans l’Entrepôt à la suite d’une livraison reçue.

**Vente** : Opération de stock simulant la sortie d’une quantité d’un seul Article, saisie par le Gestionnaire, qui diminue le stock et conserve son Contexte tarifaire de Vente.

**Inventaire** : comptage des Articles présents dans l’Entrepôt qui établit une nouvelle base de Stock physique et rapproche le stock suivi de la réalité physique.

**Écart d’inventaire** : différence constatée entre le Stock physique suivi avant un Inventaire et la quantité réellement comptée.

**Contre-mouvement** : Opération de stock explicite qui corrige une Opération de stock antérieure sans modifier ni supprimer son historique.

**Historique** : suite chronologique des opérations de stock et des changements de cycle de vie qui permet d’expliquer l’état d’un Article et de l’Entrepôt.

**Stock physique** : quantité non négative d’Articles considérée comme présente dans l’Entrepôt ; avant le premier Inventaire, elle résulte des Approvisionnements moins les Ventes, puis elle évolue depuis la base du dernier Inventaire.

**Stock vendable** : quantité d’Articles que le Gestionnaire peut proposer à la vente, calculée à partir du Stock physique et des règles de DLC et de Packaging ; elle peut être inférieure au Stock physique.

**Stock non vendable** : quantité d’Articles physiquement présente mais qui ne peut pas être proposée à la vente, égale à la différence entre le Stock physique et le Stock vendable.

**Dashboard de pilotage** : vue de synthèse destinée au Gestionnaire pour suivre l’état et l’évolution du stock à l’aide d’indicateurs et de visualisations.

## Invariants stabilisés

- Token Warehouse suit un seul Entrepôt.
- Une Vente simulée diminue la quantité en stock de l’Article vendu.
- Une Vente qui dépasse le Stock vendable courant est refusée.
- Un Article alimentaire reste vendable jusqu’au jour de sa DLC inclus, puis devient non vendable le lendemain.
- Un Article non alimentaire Invendable a un Stock vendable nul, mais reste dans le Stock physique.
- Un Article archivé conserve son identité et son Stock physique, devient non vendable et n’accepte plus de Vente ni d’Approvisionnement.
- Un Article archivé peut encore être concerné par un Inventaire ou un Contre-mouvement.
- Aucun Article ni mouvement n’est supprimé physiquement.
- L’Historique conserve les opérations, corrections, archivages, réactivations et changements de DLC ou de Packaging.
- Une modification de DLC ou de Packaging recalcule le Stock vendable.
- Les deux modes d’un Article alimentaire partagent le même Stock physique et le même Stock vendable.
- Les opérations en masse concernent plusieurs Articles sans changer la nature métier de l’Approvisionnement ou de l’Inventaire.
- Une Opération de stock validée est immédiate et immuable.
- Une Opération en masse est appliquée en totalité ou rejetée en totalité.
- Un Contre-mouvement référence l’Opération de stock qu’il corrige et indique sa justification.
- Le Stock vendable est un concept distinct du Stock physique.
- Le Stock non vendable correspond à la différence entre le Stock physique et le Stock vendable.
- Un Article en rupture est distinct d’un Article non vendable : le premier n’a plus de quantité physique, le second conserve une quantité physique bloquée.
- Un Inventaire établit une nouvelle base de Stock physique sans effacer l’historique.
- Un Écart d’inventaire est conservé lorsqu’un Inventaire modifie la base de stock.
- Le Stock physique ne peut pas être négatif.
- La référence EAN-13 est unique et immuable.
- Le type d’un Article est immuable après sa création.
- Un Article alimentaire possède une DLC et un mode de consommation.
- Un Article non alimentaire possède un Packaging.
- Une erreur de classification se corrige par archivage de l’Article puis création d’un nouvel Article.
- Un Article possède un seul Prix HT de référence.
- Le Prix TTC est calculé à partir du Prix HT et de la TVA applicable.
- Un Article alimentaire disponible dans les deux modes possède un Prix TTC applicable par contexte de Vente.
- Le Contexte de Vente est requis lorsque les deux modes sont possibles.
- Une Vente conserve le Contexte tarifaire de Vente applicable au moment de sa validation.
- Le Montant HT d’une Vente correspond au Prix HT unitaire multiplié par la quantité vendue.
- Le montant de TVA d’une Vente est calculé sur son Montant HT et arrondi au centime.
- Le Montant TTC d’une Vente est égal à son Montant HT augmenté de son montant de TVA.
- Une modification ultérieure du Prix HT d’un Article ne modifie pas les Montants d’une Vente existante.
- Un Contre-mouvement lié à une Vente inverse les Montants d’une Vente correspondants dans les indicateurs financiers.
