using System.Text.Json;

namespace Headroom;

public record LocalSettings(string? CodexPath = null, bool StartWithWindows = false);

internal static class PortableStorage
{
    public static string DataDirectory(string? option) => Path.GetFullPath(option ?? "data", AppContext.BaseDirectory);

    public static void SaveSettings(LocalSettings settings)
    {
        string path = Path.Combine(AppContext.BaseDirectory, "settings.json");
        File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(settings, AppJson.Default.LocalSettings));
        File.Move(path + ".tmp", path, true);
    }

    public static LocalSettings Settings()
    {
        string path = Path.Combine(AppContext.BaseDirectory, "settings.json");
        if (File.Exists(path))
            return JsonSerializer.Deserialize(File.ReadAllText(path), AppJson.Default.LocalSettings) ?? new();
        var defaults = new LocalSettings();
        try
        {
            using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
            JsonSerializer.Serialize(file, defaults, AppJson.Default.LocalSettings);
        }
        catch (IOException) when (File.Exists(path)) { }
        return defaults;
    }
}
