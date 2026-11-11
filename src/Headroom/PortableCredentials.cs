using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace Headroom;

internal static partial class PortableCredentials
{
    private static readonly object migrationLock = new();
    // Only reads the credential for this dashboard's isolated CODEX_HOME. Never
    // enumerates the credential store or reads the user's primary Codex profile.
    public static void Prepare(string home, bool migrateCredentials = true)
    {
        // scrypt is deliberately memory-hard; migrate accounts one at a time.
        lock (migrationLock) PrepareCore(home, migrateCredentials);
    }

    private static void PrepareCore(string home, bool migrateCredentials)
    {
        Directory.CreateDirectory(home);
        string authPath = Path.Combine(home, "auth.json");
        if (migrateCredentials && !File.Exists(authPath) && OperatingSystem.IsWindows())
        {
            string encrypted = Path.Combine(home, "secrets", "codex_auth.age");
            bool age = File.Exists(encrypted);
            byte[]? secret = ReadCredential(home, age);
            if (secret is not null)
            {
                byte[]? auth = null;
                try
                {
                    auth = age ? ReadEncryptedAuth(encrypted, secret) : secret;
                    using var json = JsonDocument.Parse(auth);
                    if (json.RootElement.ValueKind != JsonValueKind.Object ||
                        !(json.RootElement.TryGetProperty("tokens", out _) || json.RootElement.TryGetProperty("OPENAI_API_KEY", out _)))
                        throw new InvalidDataException("Unrecognized saved sign-in format.");
                    string staged = authPath + ".tmp";
                    File.WriteAllBytes(staged, auth);
                    File.Move(staged, authPath, false);
                }
                finally
                {
                    if (auth is not null) CryptographicOperations.ZeroMemory(auth);
                    CryptographicOperations.ZeroMemory(secret);
                }
            }
        }
        string configPath = Path.Combine(home, "config.toml");
        string config = File.Exists(configPath) ? File.ReadAllText(configPath) : "";
        string portableConfig = AuthStoreSetting().IsMatch(config)
            ? AuthStoreSetting().Replace(config, "cli_auth_credentials_store = \"file\"")
            : "cli_auth_credentials_store = \"file\"\n" + config;
        if (config != portableConfig) File.WriteAllText(configPath, portableConfig);
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(home, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            if (File.Exists(authPath)) File.SetUnixFileMode(authPath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
    }

    private static byte[] ReadEncryptedAuth(string path, byte[] password)
    {
        byte[] decrypted = LegacyAge.Decrypt(File.ReadAllBytes(path), password);
        try
        {
            using var envelope = JsonDocument.Parse(decrypted);
            if (envelope.RootElement.TryGetProperty("secrets", out var secrets) &&
                secrets.TryGetProperty("global/CODEX_AUTH", out var auth) && auth.ValueKind == JsonValueKind.String)
                return Encoding.UTF8.GetBytes(auth.GetString()!);
            throw new InvalidDataException("Unrecognized saved sign-in envelope.");
        }
        finally { CryptographicOperations.ZeroMemory(decrypted); }
    }

    [GeneratedRegex("(?m)^\\s*cli_auth_credentials_store\\s*=.*$")]
    private static partial Regex AuthStoreSetting();

    private static unsafe byte[]? ReadCredential(string home, bool encrypted)
    {
        using var handle = CreateFileW(home, 0, 7, 0, 3, 0x02000000, 0);
        if (handle.IsInvalid) throw new IOException("Cannot resolve the saved account folder.");
        char[] path = new char[32768];
        uint length;
        fixed (char* pointer = path) length = GetFinalPathNameByHandleW(handle, pointer, (uint)path.Length, 0);
        if (length == 0 || length >= path.Length) throw new IOException("Cannot resolve the saved account folder.");
        string hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(path.AsSpan(0, (int)length).ToString())))[..16];
        string target = encrypted ? "secrets|" + hash + ".codex" : "cli|" + hash + ".Codex Auth";
        if (!CredReadW(target, 1, 0, out nint pointerCredential))
        {
            if (Marshal.GetLastPInvokeError() == 1168) return null;
            throw new IOException("Windows could not read this Headroom account's saved sign-in.");
        }
        var credential = (Credential*)pointerCredential;
        try
        {
            if (credential->BlobSize > 1024 * 1024) throw new InvalidDataException("Saved sign-in is too large.");
            var stored = new ReadOnlySpan<byte>((void*)credential->Blob, (int)credential->BlobSize);
            // The Windows keyring backend stores password strings as UTF-16LE;
            // age scrypt and legacy JSON expect UTF-8. Older backends used UTF-8.
            if (stored.Length >= 2 && stored.Length % 2 == 0 && stored[1] == 0)
            {
                byte[] encoded = stored.ToArray();
                try { return Encoding.Convert(Encoding.Unicode, Encoding.UTF8, encoded); }
                finally { CryptographicOperations.ZeroMemory(encoded); }
            }
            return stored.ToArray();
        }
        finally
        {
            CryptographicOperations.ZeroMemory(new Span<byte>((void*)credential->Blob, (int)credential->BlobSize));
            CredFree(pointerCredential);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Credential
    {
        public uint Flags, Type;
        public nint TargetName, Comment;
        public long LastWritten;
        public uint BlobSize;
        public nint Blob;
        public uint Persist, AttributeCount;
        public nint Attributes, TargetAlias, UserName;
    }
    [LibraryImport("advapi32.dll", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static partial bool CredReadW(string target, uint type, uint flags, out nint credential);
    [LibraryImport("advapi32.dll")] private static partial void CredFree(nint credential);
    [LibraryImport("kernel32.dll", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
    private static partial SafeFileHandle CreateFileW(string path, uint access, uint share, nint attributes, uint creation, uint flags, nint template);
    [LibraryImport("kernel32.dll", SetLastError = true)]
    private static unsafe partial uint GetFinalPathNameByHandleW(SafeFileHandle file, char* path, uint length, uint flags);
}
