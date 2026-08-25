using TokenWarehouse.Api;
using TokenWarehouse.E2eHost;

WarehouseHost.Build(args, builder => builder.AddE2eSeams()).Run();
