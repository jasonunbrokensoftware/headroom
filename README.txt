HEADROOM — NATIVE .NET + VUE

All your AI usage. One place. Currently supports Codex/ChatGPT accounts.

Run app\Headroom.exe. It opens the Vue dashboard in its own desktop window.
Click "Sign in to another account" to open sign-in directly. Add any number of
accounts. Labels come automatically from your email and selected workspace;
there are no custom names. For a different ChatGPT account, copy its sign-in
link into the appropriate browser profile or private window. Cancelled new
sign-ins remove their empty cards. Remove is available on each account card.

The UI has a dark theme and a single custom title bar. Drag the title bar to
move the window; use its minimize, maximize/restore, and close buttons. Drag
an edge or corner to resize. The Windows native title bar is hidden.

The executable is compiled with .NET 10 Native AOT for Windows x64. It embeds
the Vue production library and all UI assets. Photino.NET hosts the interface
using WebView2 on Windows and WebKitGTK on Linux. Windows builds statically link
Photino and the WebView2 loader: distribute Headroom.exe alone, with no DLLs
alongside it or extracted at startup. The Microsoft Edge WebView2 runtime
must be installed (it is installed on this machine). Python, Node.js, a separate
.NET runtime, a launcher script, and an internet CDN are not required to run it.
The official Codex CLI must be installed; it manages sign-in and usage reads.

Usage refreshes every minute, with up to four account checks at once. Unknown
values remain unknown. Countdown expiry is not treated as confirmation that
an allowance has reset. Stale data is marked. Earned-reset counts and available
expiration details are displayed; the app does not redeem resets or start model
conversations.

The overview estimates capacity in Pro 100 weekly allowance equivalents.
Plus, Pro 100, Pro 200, and Pro 500 are weighted at 0.1, 1, 2, and 5 respectively,
using published November 8, 2026 plan ratios. An account with 50% left contributes
half its plan weight. Verified full resets add up to one plan allowance each.
For example, 47% and 6% left on two Pro 100 accounts plus three full resets
represent 0.53 current allowances + up to 3 banked = up to 3.53 allowances.
These are capacity equivalents, not calendar weeks, tokens, tasks, or hours.
Use existing allowance before redeeming a reset; redeem before its expiry.
Short windows and weekly limits apply to the same usage and are never added
together. Scheduled future renewals and separate model quotas are not added.
Purchased credits are displayed separately. Unknown plans, stale readings,
expired resets, and resets with unverified scope are excluded and explained.
Missing readings remain unavailable, not zero. Duplicate account/workspace
profiles count once using the freshest reading. Details, source dates, and a
per-account breakdown are under "How this estimate works". See
docs/usage-capacity.txt in the source repository for research and assumptions.

The dashboard shares one content width, with aligned account sections and
collapsible reset expiration dates. Startup shows animated placeholders until
each account's first reading arrives. Connection failures, signed-out accounts,
and a genuinely empty account list have different states. Reduced-motion system
preferences disable loading animations.

PORTABLE STORAGE

Headroom.exe creates settings.json and a data folder beside itself, independent
of the working directory or shortcut's Start in location. Accounts, their Codex
configuration and sign-ins, webview profile, icon cache, and monitoring state
stay under data. Move or copy the EXE together with settings.json and data.
Each account uses an isolated Codex home with file-based auth.json credentials.
Treat the data folder as private: these files contain your sign-in tokens.
Existing Windows keyring/encrypted-age sign-ins migrate to local files on the
first refresh at their original location; the old Windows entries are left
untouched. Reopen this updated build before moving an existing installation.
Once migrated, account sign-ins no longer depend on their absolute folder path
or Windows Credential Manager. Linux builds use the same file storage.
Removing an account
signs out only its dashboard connection. It does not change your main Codex
login. The dashboard listens only on 127.0.0.1 and protects API calls with a
random session token. Login credentials never go through the Vue frontend.

Closing the desktop window stops the utility and monitoring.
Running the EXE again brings the existing desktop window forward. Account
sign-in deliberately opens in your usual browser; the dashboard stays in its
own window. The Copy link option works with separate browser profiles.

BUILD

From the repository root, with .NET 10 SDK and the Windows C++ build tools:
  dotnet publish src/Headroom/Headroom.csproj -c Release -r win-x64 -o artifacts/single-exe

No JavaScript build step is required. Vue 3.5.24 is vendored in wwwroot/vue.js;
its MIT license is included in src/Headroom/VUE-LICENSE.txt. All frontend files are
embedded into the executable at publish time. Server JSON uses source-generated
serialization for AOT compatibility. Photino.NET 4.0.16 / Photino.Native 4.0.22
provide the desktop shell. No WinForms or WPF dependency.
The Windows publish automatically builds the pinned C++ sources in native/
with the installed Visual Studio C++ toolset. Build-Native.ps1 is a development
build helper, not an app launcher. PDB and staticwebassets diagnostic files in
publish output are not needed for distribution. Run node tests/single-exe.mjs
to verify system-only native DLL imports and run the EXE alone in a clean folder.

LINUX PATH

The same Vue UI and backend source are designed for Linux. Publish on a Linux
machine with the .NET 10 SDK and Native AOT prerequisites installed:
  dotnet publish src/Headroom/Headroom.csproj -c Release -r linux-x64 -o artifacts/linux

The Linux executable uses GTK 3 and WebKitGTK 4.1 for its desktop window, plus
xdg-open for account sign-in and the installed Codex CLI. On Ubuntu, install
libgtk-3-0 and libwebkit2gtk-4.1-0 (package names may vary by distribution).
Keep Photino.Native.so next to the executable. No desktop credential store is
required for new portable profiles. Linux has not been built or tested in this
Windows environment. Native AOT publishing must be performed on the target OS;
the Windows EXE cannot itself run on Linux.

DIAGNOSTICS

  Headroom.exe --self-test
  Headroom.exe --self-test --integration-test
  Headroom.exe --headless --data-dir <separate-test-directory>

Self-tests cover quota parsing, unknown/zero values, multiple quota buckets,
authoritative reset counts, calculated account/workspace names, migration of
existing profiles, and persistence of more than three accounts.
The optional integration test checks the installed Codex sign-in handshake and
cancellation, including cleanup of new profiles, without signing into an
account or sending model prompts.

Existing account IDs and isolated sign-ins are preserved. Old custom names
are ignored; email and workspace metadata populate on the next refresh.
If a workspace name is not reported, personal plans show Personal; other
accounts show their workspace ID when available or Workspace unavailable.

Validation for the dark/custom-title-bar update used Native AOT publishing,
Vue template compilation, and isolated backend tests. No desktop automation
or screen capture was used. Native title-bar interactions and Linux remain
for manual testing.

The Codex CLI and Windows WebView2 runtime must still be available on the target
machine. Codex is discovered beside Headroom.exe, in tools/codex.exe, on PATH,
or in its normal installation folder. To override discovery, set codexPath in
settings.json to an absolute path or a path relative to Headroom.exe, for example:
  {"codexPath":"tools/codex.exe"}
The default {"codexPath":null} enables automatic discovery. No registry setting,
user-profile configuration file, or environment variable is needed by Headroom.
Diagnostic --data-dir paths are also relative to the executable unless absolute.
Credential migration uses .NET cryptography and Bouncy Castle 2.6.2 for scrypt;
its license is preserved in src/Headroom/BouncyCastle-LICENSE.txt and embedded
in the EXE. The migration never prints tokens or changes the main Codex login.
For the isolated Windows migration/relocation test, set HEADROOM_TEST_CODEX to
the installed Codex executable and run node tests/portable.mjs. It creates and
cleans up a disposable fake credential and never sends a model request.

REPOSITORY AND CHECKS

The local Git repository is C:\Source\headroom. Application source is under
src/Headroom. Account data, credentials, local tests' data, and compiled
artifacts are excluded from Git. There is no remote configured.

After publishing, run from the repository root:
  artifacts/single-exe/Headroom.exe --self-test --integration-test
  node tests/ui.mjs
  node tests/totals.mjs
  node tests/backend.mjs
  node tests/single-exe.mjs

Optional headless layout/loading checks (requires Playwright for development):
  node tests/layout.mjs
HEADROOM_PLAYWRIGHT_PATH can point to an existing Playwright package directory;
HEADROOM_BROWSER can select an installed Chromium/Edge executable. These tests
use isolated fake accounts and no desktop window or screen capture.

The JavaScript checks need a current Node.js version for development only.
HEADROOM_TEST_EXE can point the backend test at another Headroom executable.
The delivered Windows app and saved account data are in the Headroom output
folder. Move that app/data folder together with the EXE after the first refresh
has migrated any older sign-ins. New accounts are portable from their first login.

ICON

Headroom's original vector mark is wwwroot/headroom.svg. The Windows ICO
contains 16, 20, 24, 32, 40, 48, 64, 96, 128, and 256-pixel images, including a
pixel-aligned 16px mark. A 512px PNG is included for the Linux window icon.
The EXE, native window/taskbar, title bar, and webview favicon share this mark.
The icon files are embedded; native window icons are cached under data/icons.
Regenerate the artwork on Windows with tools/Build-Icon.ps1 (development only).
