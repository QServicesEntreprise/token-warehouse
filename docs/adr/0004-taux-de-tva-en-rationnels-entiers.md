# 0004 — Taux de TVA en rationnels entiers

- **Statut** : Accepté
- **Date** : 2026-08-25

## Contexte

Le Prix HT, la TVA et le Prix TTC suivent un chemin financier exprimé en centimes. Les taux du MVP sont 5,5 % pour l’alimentaire à emporter, 10 % pour l’alimentaire sur place et 20 % pour le non alimentaire. L’arrondi de TVA doit être explicite, déterministe et vérifiable aux bornes; les montants d’une Vente doivent rester figés dans son snapshot financier.

## Décision

Le domaine représente chaque Taux de TVA par un numérateur et un dénominateur entiers : 11/200, 1/10 et 1/5. Le calcul multiplie les centimes par le numérateur, divise par le dénominateur et applique un arrondi au centime avec RoundAwayFromZero. Les Montants HT, TVA et TTC d’une Vente sont ensuite conservés dans un snapshot immuable avec le taux utilisé.

## Conséquences

Le calcul ne dépend d’aucun flottant sur un chemin financier. Les bornes et les demi-centimes sont testables avec des valeurs entières, et la modification ultérieure du Prix HT ne change pas une Vente déjà validée. Ajouter un taux exige de déclarer explicitement son ratio entier et ses tests.

## Alternatives écartées

- decimal : écarté pour conserver un chemin financier entièrement fondé sur des centimes et des opérations entières, avec un arrondi explicite et testable aux bornes.
- float ou double : écartés en raison des représentations binaires et des arrondis implicites incompatibles avec les montants financiers.
- Persister le Prix TTC comme donnée de référence : écarté car il doit être recalculé à partir du Prix HT et du contexte tarifaire.
