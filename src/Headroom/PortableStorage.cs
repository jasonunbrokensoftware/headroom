using System.Text.Json;

namespace Headroom;

public record LocalSettings(string? CodexPath = null, bool StartWithWindows = false, string Theme = "ember");
public record AppearancePreferences(string Theme);

internal static class Appearance
{
    public static bool IsTheme(string? theme) => theme is "ember" or "orchard" or "lagoon" or "rosewood";
    public static string Normalize(string? theme) => IsTheme(theme) ? theme! : "ember";
}

internal static class PortableStorage
{
    private static readonly object SettingsLock = new();
    public static string DataDirectory(string? option) => Path.GetFullPath(option ?? "data", AppContext.BaseDirectory);

    public static void SaveSettings(LocalSettings settings)
    {
        lock (SettingsLock)
        {
            string path = Path.Combine(AppContext.BaseDirectory, "settings.json");
            File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(settings, AppJson.Default.LocalSettings));
            File.Move(path + ".tmp", path, true);
        }
    }

    public static LocalSettings UpdateSettings(Func<LocalSettings, LocalSettings> update)
    {
        lock (SettingsLock)
        {
            var settings = update(Settings());
            SaveSettings(settings);
            return settings;
        }
    }

    public static LocalSettings Settings()
    {
        lock (SettingsLock)
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
}
