# Headroom

Headroom is a portable desktop dashboard for monitoring usage, reset times, and earned resets across any number of ChatGPT/Codex accounts. It uses a Vue interface in a native desktop window, backed by C# and .NET Native AOT.

Windows x64 and Linux x64 builds share the same backend and Vue interface. The Linux port is validated on Fedora 45, with isolated X11 and Wayland desktop tests. Other Linux distributions have not yet been validated.

## Features

- Multiple accounts identified by email and workspace, with usage refreshed every minute.
- Remaining allowances, reset countdowns, and earned-reset expiration dates.
- Plan-weighted capacity totals, including verified banked resets, with an account-by-account explanation.
- Service-reported daily token activity and locally recorded account-wide allowance history, including usage from other machines.
- Estimated usage runway using recent consumption, scheduled refills, and existing resets. Early estimates are labeled, and learned history survives account resets and app restarts.
- Six dark color themes, an integrated custom header, loading indicators, and responsive charts.
- The interface icon follows the theme; the EXE, taskbar, and tray keep the neutral Graphite icon.
- Tray monitoring and optional startup at login on Windows and Linux desktops with tray support.
- About Headroom in the interface footer and tray menu, with version/build details, the MIT license, and GitHub source links.
- One native executable per platform, with settings and account data stored beside it.

Headroom reads account status through the installed Codex CLI. It does not send model prompts or redeem resets. It is an independent project, not an official OpenAI application.

## Build and run on Windows

Install the .NET 10 SDK, Visual Studio C++ build tools with the Desktop development with C++ workload, the Microsoft Edge WebView2 Runtime, and the official Codex CLI.

From the repository root:

```powershell
dotnet publish src/Headroom/Headroom.csproj -c Release -r win-x64 -o artifacts/single-exe
```

Run `artifacts/single-exe/Headroom.exe`, then choose **Sign in to another account**. Sign-in opens in your browser; the dashboard runs in its own desktop window. Use a different browser profile or private window when needed.

The Windows EXE embeds the frontend and statically links the desktop shell and WebView2 loader. No accompanying DLLs, Python, Node.js, or separate .NET runtime are needed to run it. The installed WebView2 Runtime and Codex CLI remain required. Node.js is only used for development checks.

Closing the window hides Headroom in the tray and keeps monitoring active. Use **Quit Headroom** in the tray menu to exit.

Normal launches reveal the window after the interface has painted. **Start with Windows** launches with `--background`: only the tray icon appears, with no window or taskbar button. Opening Headroom from the tray reveals the prepared interface. A background launch also leaves an already-running window alone.

## Build and run on Linux

Build on Linux x64 with the .NET 10 SDK, Clang, a C++ compiler, and the development packages for GTK 3, WebKitGTK 4.1, libnotify, X11, and zlib. See the [Linux guide](docs/linux.md) for dependencies and desktop tests.

```sh
dotnet publish src/Headroom/Headroom.csproj -c Release -r linux-x64 -o artifacts/linux-native
```

Copy `artifacts/linux-native/Headroom` to a writable folder, then run it. Only this executable is needed from the publish output. GTK 3, WebKitGTK 4.1, libnotify, X11 libraries, `xdg-open`, and the Codex CLI must be available on the machine. No separate .NET runtime or Photino sidecar is required.

Run `./Headroom --install-desktop` from its permanent location to add **Headroom** to your application menu. The launcher directly executes the native binary. The tray menu offers **Start at login**, **About Headroom**, and **Quit Headroom**. Without a supported tray, the window stays accessible and closing it quits the app.

## Portable data and history

`settings.json` and `data/` are created beside the executable. Move them together to preserve accounts, settings, and history. Windows portable accounts can be copied to Linux with the Linux executable; clear a Windows-specific `codexPath` to use Linux discovery. **The data folder contains sign-in credentials and must remain private.** Runtime data and configuration are excluded from Git. Copies keep independent monitoring histories; they do not synchronize Headroom's local files.

Service-reported daily token history is downloaded when available. Allowance and reset histories are recorded while Headroom runs, using account-wide balances rather than activity from just this machine. Gaps remain unknown. Forecasts use allowance consumption, not a conversion from tokens to subscription capacity.

Capacity totals and forecasts are estimates. Plan ratios, separate limits, reset expiry, and periods when exhausted accounts could not work affect their usefulness. See [usage calculations](docs/usage-capacity.txt) and the [detailed guide](README.txt) for assumptions, storage behavior, Linux build notes, and diagnostics.

## Development checks

After publishing, run:

```powershell
node tests/ui.mjs
node tests/totals.mjs
node tests/history.mjs
node tests/backend.mjs
node tests/single-exe.mjs
```

Optional layout checks require Playwright and a Chromium-based browser:

```powershell
node tests/layout.mjs
```

`HEADROOM_PLAYWRIGHT_PATH` can point to an existing Playwright package directory; `HEADROOM_BROWSER` can select an installed Chromium or Edge executable. These checks use isolated fixtures and a headless browser.

## License

Headroom's original code and artwork are available under the [MIT License](LICENSE). Third-party components retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
