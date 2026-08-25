using System.Globalization;
using TokenWarehouse.Application;
using TokenWarehouse.Domain;

namespace TokenWarehouse.Api;

/// <summary>
/// Peuple l'Entrepôt au démarrage lorsque le Catalogue est vide, pour que
/// l'application ne s'ouvre jamais sur des écrans sans données. Le peuplement
/// passe par les use cases : les invariants, l'Historique et les snapshots
/// financiers restent produits par le Domain, jamais écrits en base à la main.
/// </summary>
public sealed class DemoDataSeeder(
    IServiceScopeFactory scopeFactory,
    IHostEnvironment environment,
    IClock clock,
    ILogger<DemoDataSeeder> logger) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        // Les hôtes de test composent leur propre jeu de données.
        if (environment.IsEnvironment("Testing"))
        {
            return;
        }

        await using var scope = scopeFactory.CreateAsyncScope();
        var services = scope.ServiceProvider;

        var catalogue = await services.GetRequiredService<IListArticlesUseCase>()
            .ListAsync(new ArticleListQuery { Status = "all" }, cancellationToken);
        if (catalogue.Status != ArticleListStatus.Success || catalogue.Articles.Count > 0)
        {
            return;
        }

        try
        {
            await SeedAsync(services, cancellationToken);
            logger.LogInformation(
                "Catalogue vide au démarrage : {ArticleCount} Articles de démonstration créés.",
                DemoArticles.Length);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Un jeu de démonstration incomplet ne doit jamais empêcher l'API de servir.
            logger.LogWarning(exception, "Le peuplement de démonstration a échoué.");
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private async Task SeedAsync(IServiceProvider services, CancellationToken cancellationToken)
    {
        var today = clock.WarehouseDate;
        var create = services.GetRequiredService<ICreateArticleUseCase>();

        foreach (var article in DemoArticles)
        {
            var result = await create.CreateAsync(
                new CreateArticleCommand
                {
                    Ean13 = article.Ean13,
                    Type = article.Type,
                    Name = article.Name,
                    PriceHtCents = article.PriceHtCents,
                    Dlc = article.Type == "food"
                        ? today.AddDays(article.DlcOffsetDays).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                        : null,
                    ConsumptionModes = article.ConsumptionModes,
                    Packaging = article.Packaging
                },
                cancellationToken);

            if (result.Status != ArticleCreateStatus.Created)
            {
                logger.LogWarning(
                    "Article de démonstration {Ean13} refusé : {Status} {Errors}",
                    article.Ean13,
                    result.Status,
                    string.Join(", ", result.Errors.Select(error => $"{error.Field}: {error.Message}")));
            }
        }

        // Réception initiale : une seule Opération, une ligne par Article.
        var supply = await services.GetRequiredService<IRecordBulkSupplyUseCase>().RecordBulkAsync(
            new BulkSupplyCommand
            {
                Lines = [.. DemoArticles.Select(article => new BulkSupplyLineCommand
                {
                    Ean13 = article.Ean13,
                    Quantity = article.SupplyQuantity,
                    Ean13Provided = true,
                    QuantityProvided = true
                })]
            },
            cancellationToken);

        if (supply.Status != BulkSupplyStatus.Committed)
        {
            logger.LogWarning("Approvisionnement de démonstration refusé : {Status}", supply.Status);
            return;
        }

        // Ventes : un exemplaire de chaque taux de TVA, pour que le Dashboard
        // et l'Historique aient des faits financiers à montrer.
        var sales = services.GetRequiredService<ISaleContract>();
        var correctableSaleId = null as string;
        foreach (var sale in DemoSales)
        {
            var result = await sales.RecordAsync(
                new SaleCommand
                {
                    Ean13 = sale.Ean13,
                    Quantity = sale.Quantity,
                    Context = sale.Context,
                    ContextProvided = sale.Context is not null
                },
                cancellationToken);

            if (result.Status != SaleStatus.Committed)
            {
                logger.LogWarning(
                    "Vente de démonstration {Ean13} refusée : {Status}",
                    sale.Ean13,
                    result.Status);
                continue;
            }

            correctableSaleId ??= result.Receipt?.Operation.Id;
        }

        // Inventaire : un écart négatif et un écart nul, jamais silencieux.
        var inventory = await services.GetRequiredService<IRegisterBulkInventoryUseCase>().RegisterBulkAsync(
            new RegisterBulkInventoryCommand
            {
                Lines =
                [
                    new RegisterBulkInventoryLineCommand { LineNumber = 1, Ean13 = "5000000000012", CountedQuantity = 38 },
                    new RegisterBulkInventoryLineCommand { LineNumber = 2, Ean13 = "6000000000011", CountedQuantity = 12 }
                ]
            },
            cancellationToken);

        if (inventory.Status != BulkInventoryRegistrationStatus.Committed)
        {
            logger.LogWarning("Inventaire de démonstration refusé : {Status}", inventory.Status);
        }

        // Contre-mouvement : une Vente saisie en double, corrigée sans réécrire le passé.
        if (correctableSaleId is not null)
        {
            var correction = await services.GetRequiredService<IRegisterCounterMovementUseCase>().CorrectAsync(
                new CounterMovementCommand
                {
                    SourceOperationId = correctableSaleId,
                    Justification = "Erreur de saisie : la commande a été encaissée deux fois."
                },
                cancellationToken);

            if (correction.Status != CounterMovementRegistrationStatus.Committed)
            {
                logger.LogWarning("Contre-mouvement de démonstration refusé : {Status}", correction.Status);
            }
        }

        // Archivage en dernier : un Article archivé refuse tout approvisionnement.
        var lifecycle = services.GetRequiredService<IChangeArticleLifecycleUseCase>();
        foreach (var article in DemoArticles.Where(article => article.Archived))
        {
            var result = await lifecycle.ChangeLifecycleAsync(
                article.Ean13,
                ArticleLifecycleStatus.Archived,
                cancellationToken);

            if (result.Status != ArticleLifecycleChangeStatus.Updated)
            {
                logger.LogWarning(
                    "Archivage de démonstration {Ean13} refusé : {Status}",
                    article.Ean13,
                    result.Status);
            }
        }
    }

    private sealed record DemoArticle(
        string Ean13,
        string Name,
        string Type,
        int PriceHtCents,
        int SupplyQuantity,
        int DlcOffsetDays = 0,
        string[]? ConsumptionModes = null,
        string? Packaging = null,
        bool Archived = false);

    private sealed record DemoSale(string Ean13, int Quantity, string? Context);

    // Alimentaire = modèle de langage. À emporter = poids ouverts récupérables,
    // sur place = modèle propriétaire consommé chez son fournisseur.
    // Non alimentaire = infrastructure de calcul. La DLC porte l'obsolescence du modèle.
    private static readonly DemoArticle[] DemoArticles =
    [
        new("5000000000012", "Llama 3.1 8B — poids ouverts", "food", 1_900, 40, 180, ["takeaway"]),
        new("5000000000029", "Qwen 3 32B — poids ouverts", "food", 4_500, 25, 240, ["takeaway"]),
        new("5000000000036", "DeepSeek R1 — poids ouverts", "food", 6_900, 18, 150, ["takeaway"]),
        new("5000000000043", "Gemma 3 12B — poids ouverts", "food", 2_400, 30, 200, ["takeaway"]),
        new("5000000000050", "GPT-5.6 — accès API", "food", 12_000, 60, 90, ["onsite"]),
        new("5000000000067", "Claude Opus 5 — accès API", "food", 15_000, 55, 120, ["onsite"]),
        new("5000000000074", "Gemini 3 Pro — accès API", "food", 11_000, 45, 100, ["onsite"]),
        new("5000000000081", "Mistral Large 3 — poids ouverts et API", "food", 8_900, 22, 160, ["takeaway", "onsite"]),
        new("5000000000098", "Qwen 3 Max — poids ouverts et API", "food", 9_900, 20, 210, ["takeaway", "onsite"]),
        new("5000000000104", "Gemma 2 9B — lot à écouler", "food", 800, 12, 3, ["takeaway"]),
        // DLC dépassée : encore en stock, plus vendable.
        new("5000000000111", "Llama 2 7B — millésime 2023", "food", 300, 9, -420, ["takeaway"]),
        // Archivé : retiré de la vente, son passé reste lisible.
        new("5000000000128", "GPT-3.5 Turbo — fin de série", "food", 900, 6, -120, ["onsite"], Archived: true),

        new("6000000000011", "Gaming PC — RTX 5080", "nonFood", 249_900, 14, Packaging: "new"),
        new("6000000000028", "AI Workstation — 2× RTX 6000 Ada", "nonFood", 899_000, 8, Packaging: "refurbished"),
        new("6000000000035", "GPU Server — 4× L40S", "nonFood", 2_490_000, 5, Packaging: "new"),
        // Invendable : refroidissement défaillant.
        new("6000000000042", "GPU Server — 8× A100", "nonFood", 3_900_000, 3, Packaging: "unsellable"),
        new("6000000000059", "H100 Server — 8× H100 SXM", "nonFood", 24_900_000, 4, Packaging: "new"),
        new("6000000000066", "AI Rack — 4× H100 Server", "nonFood", 89_000_000, 2, Packaging: "refurbished"),
        new("6000000000073", "Datacenter — 12 MW", "nonFood", 1_200_000_000, 1, Packaging: "new"),
        // Invendable : lancement orbital non planifié.
        new("6000000000080", "Space Datacenter — orbite basse", "nonFood", 1_500_000_000, 1, Packaging: "unsellable")
    ];

    // Un exemplaire par taux : 5,5 % à emporter, 10 % sur place, 20 % non alimentaire.
    private static readonly DemoSale[] DemoSales =
    [
        new("5000000000012", 4, "takeaway"),
        new("5000000000067", 6, null),
        new("5000000000081", 2, "onsite"),
        new("5000000000098", 3, "takeaway"),
        new("6000000000011", 2, null),
        new("6000000000035", 1, null)
    ];
}
