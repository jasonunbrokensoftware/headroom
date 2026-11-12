#include "Headroom.Window.h"
#include <dwmapi.h>
#pragma comment(lib, "dwmapi.lib")

namespace { constexpr wchar_t StartupStyle[] = L"Headroom.StartupStyle"; }

extern "C" HRESULT Headroom_BeginWindowStartup(HWND window) {
    auto style = GetWindowLongPtrW(window, GWL_EXSTYLE);
    BOOL cloak = TRUE;
    HRESULT result = DwmSetWindowAttribute(window, DWMWA_CLOAK, &cloak, sizeof(cloak));
    if (FAILED(result)) return result;
    if (!SetPropW(window, StartupStyle, reinterpret_cast<HANDLE>(style + 1))) return HRESULT_FROM_WIN32(GetLastError());
    SetWindowLongPtrW(window, GWL_EXSTYLE, (style & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
    ShowWindow(window, SW_SHOWNOACTIVATE);
    UpdateWindow(window);
    return S_OK;
}

extern "C" HRESULT Headroom_CompleteWindowStartup(HWND window, BOOL reveal) {
    auto saved = reinterpret_cast<LONG_PTR>(GetPropW(window, StartupStyle));
    if (!saved) return S_FALSE; // Repeated readiness messages must never reopen a hidden window.
    DwmFlush();
    // Change taskbar eligibility while hidden, still under the startup cloak.
    ShowWindow(window, SW_HIDE);
    SetWindowLongPtrW(window, GWL_EXSTYLE, saved - 1);
    SetWindowPos(window, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    BOOL cloak = FALSE;
    HRESULT result = DwmSetWindowAttribute(window, DWMWA_CLOAK, &cloak, sizeof(cloak));
    if (FAILED(result)) return result;
    RemovePropW(window, StartupStyle);
    if (reveal) { ShowWindow(window, SW_SHOW); SetForegroundWindow(window); }
    return S_OK;
}
