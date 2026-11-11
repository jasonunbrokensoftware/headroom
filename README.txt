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
using WebView2 on Windows and WebKitGTK on Linux. Keep Photino.Native.dll and
WebView2Loader.dll next to Headroom.exe. The Microsoft Edge WebView2 runtime
must be installed (it is installed on this machine). Python, Node.js, a separate
.NET runtime, a launcher script, and an internet CDN are not required to run it.
The official Codex CLI must be installed; it manages sign-in and usage reads.

Usage refreshes every minute, with up to four account checks at once. Unknown
values remain unknown. Countdown expiry is not treated as confirmation that
an allowance has reset. Stale data is marked. Earned-reset counts and available
expiration details are displayed; the app does not redeem resets or start model
conversations.

Accounts and local instance state are saved under app\data. Each account has
an isolated Codex home; Codex protects credentials with the OS credential
store (including encrypted local auth files in current CLI versions).
Keep the app folder in the same place after signing in. Removing an account
signs out only its dashboard connection. It does not change your main Codex
login. The dashboard listens only on 127.0.0.1 and protects API calls with a
random session token. Login credentials never go through the Vue frontend.

Closing the desktop window stops the utility and monitoring.
Running the EXE again brings the existing desktop window forward. Account
sign-in deliberately opens in your usual browser; the dashboard stays in its
own window. The Copy link option works with separate browser profiles.

BUILD

From the repository root, with .NET 10 SDK and the Windows C++ build tools:
  dotnet publish src/Headroom/Headroom.csproj -c Release -r win-x64 -o artifacts/windows

No JavaScript build step is required. Vue 3.5.24 is vendored in wwwroot/vue.js;
its MIT license is included in src/Headroom/VUE-LICENSE.txt. All frontend files are
embedded into the executable at publish time. Server JSON uses source-generated
serialization for AOT compatibility. Photino.NET 4.0.16 / Photino.Native 4.0.22
provide the desktop shell. No WinForms or WPF dependency.

LINUX PATH

The same Vue UI and backend source are designed for Linux. Publish on a Linux
machine with the .NET 10 SDK and Native AOT prerequisites installed:
  dotnet publish src/Headroom/Headroom.csproj -c Release -r linux-x64 -o artifacts/linux

The Linux executable uses GTK 3 and WebKitGTK 4.1 for its desktop window, plus
xdg-open for account sign-in and the installed Codex CLI. On Ubuntu, install
libgtk-3-0 and libwebkit2gtk-4.1-0 (package names may vary by distribution).
Keep Photino.Native.so next to the executable. Codex's keyring mode requires a
working desktop credential store. Linux has not been built or tested in this
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

Set HEADROOM_CODEX_PATH to an explicit Codex executable if auto-discovery
cannot locate your installation.

REPOSITORY AND CHECKS

The local Git repository is C:\Source\headroom. Application source is under
src/Headroom. Account data, credentials, local tests' data, and compiled
artifacts are excluded from Git. There is no remote configured.

After publishing, run from the repository root:
  artifacts/windows/Headroom.exe --self-test --integration-test
  node tests/ui.mjs
  node tests/backend.mjs

The JavaScript checks need a current Node.js version for development only.
HEADROOM_TEST_EXE can point the backend test at another Headroom executable.
The delivered Windows app and saved account data are in the Headroom output
folder. Keep that app/data folder at its installed path to preserve sign-ins.
