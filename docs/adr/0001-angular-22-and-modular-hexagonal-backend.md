# 0001 — Angular 22 et backend hexagonal modulaire

- **Statut** : Accepté
- **Date** : 2026-08-25

## Contexte

Token Warehouse est un back-office mono-entrepôt destiné à rendre les invariants métier visibles et testables dans le cadre d’un MVP. Le frontend doit utiliser Angular 22 et le backend doit rester assez petit pour être livré, expliqué et exécuté localement. Les règles métier doivent rester indépendantes des frameworks web, de l’ORM et de la persistance.

## Décision

Nous retenons un monolithe modulaire composé d’un frontend Angular 22 standalone avec Signals et Signal Forms, et d’un backend ASP.NET Core 10 Minimal API en C#. Le backend est organisé en zones Domain, Application, Infrastructure et Presentation, avec des ports applicatifs et des adapters EF Core/SQLite. Le domaine utilise uniquement les agrégats, entités, value objects et policies justifiés par les invariants.

Le contrat entre Angular et le backend est REST JSON. La Presentation assemble les adapters et mappe les DTO; le Domain ne dépend d’aucun framework. Les opérations métier restent des faits explicites et immuables, persistés avec la position courante dans SQLite.

## Conséquences

Les règles de stock, de vendabilité et de tarification restent testables sans HTTP, Angular ou EF Core. Le système est déployable comme une seule application et ne nécessite aucun service externe pour le MVP. Les frontières Domain/Application/Infrastructure/Presentation rendent possible l’utilisation de fakes et de tests d’intégration ciblés.

La solution accepte les limites d’un monolithe local et de SQLite : elle ne fournit ni montée en charge multi-instance, ni séparation de déploiement. Toute évolution vers une architecture distribuée devra répondre à un besoin réel.

## Alternatives écartées

- Microservices et microfrontend : coût opérationnel disproportionné pour un entrepôt unique et un MVP.
- CQRS complet, bus de commandes, event sourcing et bus d’événements : complexité sans comportement requis.
- Repository générique et scaffolding DDD : abstractions sans responsabilité métier réelle.
- Contrôleurs MVC et framework de formulaires supplémentaire : la surface Minimal API et les capacités natives d’Angular suffisent.
