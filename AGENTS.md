# Working preferences

- Commit each completed logical change separately after relevant validation.
- Keep the C# Native AOT backend and Vue desktop UI compatible with future Linux builds.
- Do not use Python or script-based app launchers.
- Use builds and headless checks for validation. Do not control the desktop or capture the screen unless the user explicitly requests it.
- EXE links in Codex open a binary preview. Refer the user to the Headroom Windows shortcut when explaining how to launch the app.
- Never move or rename an installed EXE into an archive during an update. Windows shortcut tracking can follow the old file and launch it with an empty portable data folder. Use tools/Update-Portable.ps1 after Headroom is fully quit; it copies a non-executable backup and writes the new EXE in place while preserving file identity. If the app is running, stage the build and wait for it to be quit instead of replacing it by rename.
