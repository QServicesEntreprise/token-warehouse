// ponytail: le ton est choisi à partir du libellé déjà traduit, pas de l'énumération
// serveur, parce que Catalogue, Stock, Ventes et Dashboard exposent trois
// vocabulaires différents pour les mêmes états. Le jeu de libellés est fermé ;
// renommer un libellé sans toucher cette table rend la pastille grise, pas fausse.
// Passer à une table par contexte le jour où un libellé devient dynamique.
const tones: Record<string, string> = {
  Disponible: 'badge badge--ok',
  Actif: 'badge badge--ok',
  Rupture: 'badge badge--warn',
  'Non vendable': 'badge badge--bad',
  Archivé: 'badge badge--muted',
};

export const badgeTone = (label: string): string => tones[label] ?? 'badge badge--muted';
