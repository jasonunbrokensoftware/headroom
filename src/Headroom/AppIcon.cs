using System.Reflection;

namespace Headroom;

internal static class AppIcon
{
    // Photino needs a file for its native window icon. Both formats are embedded,
    // so the executable can recreate this cache after an update or a clean install.
    // OS surfaces keep one neutral identity; only the Vue interface follows the theme.
    public static string WindowIcon(string dataDirectory) => Extract(dataDirectory, "graphite");

    internal static string Extract(string dataDirectory, string theme)
    {
        string filename = "headroom-" + Appearance.Normalize(theme) + (OperatingSystem.IsWindows() ? ".ico" : ".png");
        string directory = Path.Combine(dataDirectory, "icons");
        Directory.CreateDirectory(directory);
        string path = Path.Combine(directory, filename);
        using var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("brand." + filename)
            ?? throw new InvalidOperationException("Missing Headroom icon.");
        using var buffer = new MemoryStream();
        resource.CopyTo(buffer);
        byte[] bytes = buffer.ToArray();
        if (!File.Exists(path) || !File.ReadAllBytes(path).AsSpan().SequenceEqual(bytes))
        {
            File.WriteAllBytes(path + ".tmp", bytes);
            File.Move(path + ".tmp", path, true);
        }
        return path;
    }
}
