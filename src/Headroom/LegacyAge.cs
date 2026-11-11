using System.Security.Cryptography;
using System.Text;
using Org.BouncyCastle.Crypto.Generators;

namespace Headroom;

// Read-only migration of Codex's single-recipient age v1 scrypt credential file.
// Format: https://age-encryption.org/v1. All cryptographic primitives come from
// .NET and Bouncy Castle; validates the wrapped key, header MAC, and final chunk.
internal static class LegacyAge
{
    public static byte[] Decrypt(byte[] input, byte[] password)
    {
        if (input.Length > 1024 * 1024) throw new InvalidDataException("Saved sign-in is too large.");
        int cursor = 0;
        string Line()
        {
            int end = Array.IndexOf(input, (byte)'\n', cursor);
            if (end < 0 || end - cursor > 200) throw new InvalidDataException("Invalid saved sign-in header.");
            string line = Encoding.ASCII.GetString(input, cursor, end - cursor);
            cursor = end + 1;
            return line;
        }
        if (Line() != "age-encryption.org/v1") throw new InvalidDataException("Unsupported saved sign-in format.");
        string[] stanza = Line().Split(' ');
        if (stanza.Length != 4 || stanza[0] != "->" || stanza[1] != "scrypt" ||
            !int.TryParse(stanza[3], out int work) || work < 1 || work > 20 || work.ToString() != stanza[3])
            throw new InvalidDataException("Unsupported saved sign-in encryption.");
        byte[] salt = Base64(stanza[2], 16), wrapped = Base64(Line(), 32);
        int authenticatedLength = cursor + 3;
        string macLine = Line();
        if (!macLine.StartsWith("--- ")) throw new InvalidDataException("Invalid saved sign-in header.");
        byte[] mac = Base64(macLine[4..], 32);
        if (input.Length - cursor < 32) throw new InvalidDataException("Truncated saved sign-in.");
        byte[] wrapKey = SCrypt.Generate(password, [.. Encoding.ASCII.GetBytes("age-encryption.org/v1/scrypt"), .. salt], 1 << work, 8, 1, 32);
        byte[] fileKey = new byte[16], headerKey = new byte[32], payloadKey = new byte[32];
        using var plaintext = new MemoryStream();
        try
        {
            using (var aead = new ChaCha20Poly1305(wrapKey)) aead.Decrypt(new byte[12], wrapped.AsSpan(0, 16), wrapped.AsSpan(16), fileKey);
            HKDF.DeriveKey(HashAlgorithmName.SHA256, fileKey, headerKey, [], "header"u8);
            if (!CryptographicOperations.FixedTimeEquals(mac, HMACSHA256.HashData(headerKey, input.AsSpan(0, authenticatedLength))))
                throw new CryptographicException("Saved sign-in integrity check failed.");
            HKDF.DeriveKey(HashAlgorithmName.SHA256, fileKey, payloadKey, input.AsSpan(cursor, 16), "payload"u8);
            cursor += 16;
            using var payload = new ChaCha20Poly1305(payloadKey);
            byte[] nonce = new byte[12];
            while (cursor < input.Length)
            {
                int size = Math.Min(65536 + 16, input.Length - cursor);
                bool final = cursor + size == input.Length;
                if (size < 16 || (size == 16 && plaintext.Length > 0)) throw new InvalidDataException("Truncated saved sign-in.");
                nonce[11] = final ? (byte)1 : (byte)0;
                byte[] chunk = new byte[size - 16];
                try
                {
                    payload.Decrypt(nonce, input.AsSpan(cursor, size - 16), input.AsSpan(cursor + size - 16, 16), chunk);
                    plaintext.Write(chunk);
                }
                finally { CryptographicOperations.ZeroMemory(chunk); }
                cursor += size;
                for (int i = 10; i >= 0 && ++nonce[i] == 0; i--) { }
            }
            return plaintext.ToArray();
        }
        finally
        {
            CryptographicOperations.ZeroMemory(wrapKey);
            CryptographicOperations.ZeroMemory(fileKey);
            CryptographicOperations.ZeroMemory(headerKey);
            CryptographicOperations.ZeroMemory(payloadKey);
            CryptographicOperations.ZeroMemory(plaintext.GetBuffer());
        }
    }

    private static byte[] Base64(string text, int length)
    {
        byte[] value = Convert.FromBase64String(text + new string('=', (4 - text.Length % 4) % 4));
        if (value.Length != length || Convert.ToBase64String(value).TrimEnd('=') != text)
            throw new InvalidDataException("Invalid saved sign-in encoding.");
        return value;
    }
}
