#pragma once
#include <windows.h>

// Keep the initial WebView composited without a visible window or taskbar button.
extern "C" HRESULT Headroom_BeginWindowStartup(HWND window);
extern "C" HRESULT Headroom_CompleteWindowStartup(HWND window, BOOL reveal);
