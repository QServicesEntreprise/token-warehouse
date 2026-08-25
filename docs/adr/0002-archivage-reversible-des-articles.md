# 0002 — Archivage réversible plutôt que suppression d’un Article

- **Statut** : Accepté
- **Date** : 2026-08-25

## Contexte

Un Article est identifié par un EAN-13 unique et immuable. Son Stock physique et son Historique doivent rester explicables après son retrait du Catalogue actif. Une erreur de classification ne doit pas permettre de modifier rétroactivement le type d’un Article déjà utilisé.

## Décision

L’Article est archivé par une transition de cycle de vie réversible. L’archivage conserve l’EAN-13, le Stock physique et l’Historique; il rend l’Article non vendable et interdit les Ventes et Approvisionnements. Un Article archivé reste consultable et peut encore être concerné par un Inventaire ou un Contre-mouvement. La réactivation remet l’Article dans le Catalogue actif et réévalue sa vendabilité.

Une erreur de classification se corrige par archivage de l’Article puis création d’une nouvelle référence, et non par modification de son type.

## Conséquences

Les identités et les références historiques restent stables, aucune suppression physique n’est nécessaire et le Gestionnaire dispose d’un parcours explicite d’archivage/réactivation. Les vues de Catalogue et de Stock doivent distinguer les Articles actifs et archivés; les opérations d’écriture doivent contrôler le cycle de vie.

Le stockage conserve davantage de données, mais cette conservation est nécessaire à la traçabilité métier.

## Alternatives écartées

- Suppression physique : elle détruirait l’identité, le Stock et l’Historique nécessaires à l’audit.
- Modification du type d’un Article existant : elle rendrait ambiguës les règles de DLC, Packaging et les opérations déjà validées.
- Réutilisation de l’EAN-13 après suppression : elle ferait coexister plusieurs histoires pour une même référence.
