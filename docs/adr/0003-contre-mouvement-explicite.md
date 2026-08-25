# 0003 — Contre-mouvement explicite plutôt qu’édition d’un fait passé

- **Statut** : Accepté
- **Date** : 2026-08-25

## Contexte

Une Opération de stock validée est immédiate et immuable. Une correction doit pourtant pouvoir annuler l’effet d’un Approvisionnement, d’un Inventaire ou d’une Vente sans réécrire l’Historique. Le stock courant peut avoir évolué depuis l’Opération source; la correction doit donc être calculée sur la position courante et refuser un résultat négatif.

## Décision

Toute correction est une nouvelle Opération de stock de type Contre-mouvement. Elle référence exactement une Opération source, porte une justification obligatoire et contient une ligne inverse pour chaque effet source. Une source ne peut être corrigée qu’une fois et un Contre-mouvement ne peut pas lui-même être corrigé. La politique vérifie la compatibilité du type source et la non-négativité du Stock physique avant la transaction.

Lorsqu’il corrige une Vente, le Contre-mouvement conserve également la réversion financière du snapshot HT, TVA et TTC de cette Vente.

## Conséquences

L’Historique est append-only : la source et sa correction restent visibles et l’état courant est explicable. Les corrections sont des faits métier auditables et peuvent être rejetées en cas de conflit de version ou de Stock insuffisant. Le Dashboard doit comptabiliser séparément l’effet financier inverse d’un Contre-mouvement lié à une Vente.

Le modèle conserve plus de lignes qu’une mise à jour, mais il évite toute perte d’information et impose un parcours de correction explicite.

## Alternatives écartées

- Modifier ou supprimer l’Opération source : cela détruirait la trace de ce qui a réellement été validé.
- Recalculer toute l’histoire pour reconstruire le stock : coût et complexité inutiles alors que la correction inverse est un fait métier suffisant.
- Autoriser la correction d’un Contre-mouvement : cela créerait une chaîne de corrections difficile à expliquer.
