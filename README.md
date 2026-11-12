# Headroom

Headroom is a portable desktop dashboard for monitoring usage, reset times, and earned resets across any number of ChatGPT/Codex accounts. It uses a Vue interface in a native desktop window, backed by C# and .NET Native AOT.

Windows x64 is the current supported platform. The shared backend and Vue interface are designed for future Linux support; Linux builds and desktop behavior have not yet been validated.

## Features

- Multiple accounts identified by email and workspace, with usage refreshed every minute.
- Remaining allowances, reset countdowns, and earned-reset expiration dates.
- Plan-weighted capacity totals, including verified banked resets, with an account-by-account explanation.
- Service-reported daily token activity and locally recorded account-wide allowance history, including usage from other machines.
- Estimated usage runway using recent consumption, scheduled refills, and existing resets. Early estimates are labeled, and learned history survives account resets and app restarts.
- Six dark color themes, an integrated custom header, loading indicators, and responsive charts.
- Windows tray monitoring and optional Start with Windows.
- A single Windows EXE with settings and account data stored beside it.

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

## Portable data and history

`settings.json` and `data/` are created beside the EXE. Move them together with the executable to preserve accounts, settings, and history. **The data folder contains sign-in credentials and must remain private.** Runtime data and configuration are excluded from Git.

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
