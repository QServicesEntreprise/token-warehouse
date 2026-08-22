using TokenWarehouse.Application;
using TokenWarehouse.Domain;
using Xunit;

namespace TokenWarehouse.Application.Tests;

public sealed class HistoryApplicationTests
{
    [Fact]
    public async Task Rejects_an_empty_filter_before_reading()
    {
        var reader = new RecordingHistoryReader();
        var application = new HistoryApplication(reader);

        var result = await application.GetAsync(string.Empty);

        Assert.Equal(HistoryReadStatus.ValidationFailed, result.Status);
        Assert.Contains(result.Errors, error => error.Code == "INVALID_EAN13");
        Assert.Equal(0, reader.Calls);
    }

    [Fact]
    public async Task Returns_the_reader_result_without_rebuilding_history()
    {
        var expected = new HistoryReadResult(
            HistoryReadStatus.Success,
            [new HistoryEntryView
            {
                Id = "operation-2",
                Type = HistoryEntryType.Supply,
                TimestampUtc = new DateTimeOffset(2030, 1, 15, 10, 0, 0, TimeSpan.Zero),
                Articles = [new HistoryArticleView(Ean("0123456789012"))]
            }],
            []);
        var reader = new RecordingHistoryReader { Result = expected };
        var application = new HistoryApplication(reader);

        var result = await application.GetAsync("0123456789012");

        Assert.Same(expected, result);
        Assert.Equal(Ean("0123456789012"), reader.Query?.Ean13);
    }

    [Fact]
    public async Task Maps_reader_failures_to_a_stable_history_error()
    {
        var application = new HistoryApplication(new RecordingHistoryReader
        {
            Failure = new InvalidOperationException("database details")
        });

        var result = await application.GetAsync();

        Assert.Equal(HistoryReadStatus.PersistenceFailed, result.Status);
        var error = Assert.Single(result.Errors);
        Assert.Equal("HISTORY_READ_FAILURE", error.Code);
        Assert.DoesNotContain("database details", error.Message);
    }

    private sealed class RecordingHistoryReader : IHistoryReader
    {
        public HistoryReadResult Result { get; init; } = new(HistoryReadStatus.Success, [], []);

        public Exception? Failure { get; init; }

        public int Calls { get; private set; }

        public HistoryQuery? Query { get; private set; }

        public ValueTask<HistoryReadResult> ReadAsync(
            HistoryQuery query,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            Query = query;
            if (Failure is not null)
            {
                throw Failure;
            }

            return ValueTask.FromResult(Result);
        }
    }

    private static Ean13 Ean(string value)
        => Ean13.TryCreate(value, out var ean13)
            ? ean13
            : throw new InvalidOperationException("Invalid test EAN.");
}
