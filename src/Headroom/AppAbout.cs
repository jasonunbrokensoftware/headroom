using System.Reflection;

namespace Headroom;

internal sealed record AboutView(string Version, string? Build, string Copyright, string License,
    string LicenseText, string RepositoryUrl, string LicenseUrl, string NoticesUrl);

internal static class AppAbout
{
    internal const string RepositoryUrl = "https://github.com/jasonunbrokensoftware/headroom";
    internal static readonly AboutView Info = Read();

    internal static string Link(string destination) => destination switch
    {
        "source" => RepositoryUrl,
        "license" => RepositoryUrl + "/blob/main/LICENSE",
        "notices" => RepositoryUrl + "/blob/main/THIRD_PARTY_NOTICES.md",
        _ => throw new ArgumentException("Unknown About link.")
    };

    private static AboutView Read()
    {
        var assembly = typeof(AppAbout).Assembly;
        string version = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
            ?? assembly.GetName().Version?.ToString(3) ?? "Unavailable";
        string[] parts = version.Split('+', 2);
        using var license = assembly.GetManifestResourceStream("licenses/Headroom.txt")
            ?? throw new InvalidOperationException("Missing Headroom license.");
        using var reader = new StreamReader(license);
        return new(parts[0], parts.Length > 1 ? parts[1] : null,
            assembly.GetCustomAttribute<AssemblyCopyrightAttribute>()?.Copyright ?? "",
            "MIT", reader.ReadToEnd(), Link("source"), Link("license"), Link("notices"));
    }
}
