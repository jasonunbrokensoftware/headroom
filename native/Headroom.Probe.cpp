#include "photino/Photino.h"
#include "Headroom.Window.h"
#include <dwmapi.h>
#include <memory>
#include <wrl.h>
// Exercises both statically linked components without creating a desktop window.
extern "C" int Headroom_WebViewRuntimeAvailable()
{
    LPWSTR version = nullptr;
    HRESULT result = GetAvailableCoreWebView2BrowserVersionString(nullptr, &version);
    bool available = SUCCEEDED(result) && version != nullptr;
    CoTaskMemFree(version);
    return available ? 1 : 0;
}

// Uses an isolated WebView profile and the production startup path. The HWND
// stays cloaked until it is hidden, so this probe never displays desktop UI.
extern "C" int Headroom_TestStartupRendering(const wchar_t* directory)
{
    HRESULT apartment = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(apartment)) return 1;
    struct State {
        HWND window = nullptr;
        Microsoft::WRL::ComPtr<ICoreWebView2Controller> controller;
        Microsoft::WRL::ComPtr<ICoreWebView2> web;
        bool finished = false, closed = false;
        int result = 2;
    };
    auto state = std::make_shared<State>();
    state->window = CreateWindowExW(WS_EX_APPWINDOW, L"STATIC", L"Headroom hidden rendering test",
        WS_OVERLAPPEDWINDOW, 0, 0, 800, 600, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
    auto originalStyle = GetWindowLongPtrW(state->window, GWL_EXSTYLE);
    auto verifyCloaked = [state]() {
        DWORD cloak = 0;
        auto style = GetWindowLongPtrW(state->window, GWL_EXSTYLE);
        return SUCCEEDED(DwmGetWindowAttribute(state->window, DWMWA_CLOAKED, &cloak, sizeof(cloak))) &&
            (cloak & DWM_CLOAKED_APP) && (style & WS_EX_TOOLWINDOW) && (style & WS_EX_NOACTIVATE) && !(style & WS_EX_APPWINDOW);
    };
    if (state->window && SUCCEEDED(Headroom_BeginWindowStartup(state->window)) && verifyCloaked()) {
        HRESULT started = CreateCoreWebView2EnvironmentWithOptions(nullptr, directory, nullptr,
            Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [state](HRESULT hr, ICoreWebView2Environment* environment) -> HRESULT {
                if (state->closed) return E_ABORT;
                if (FAILED(hr)) { state->finished = true; state->result = 3; return hr; }
                HRESULT created = environment->CreateCoreWebView2Controller(state->window,
                    Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                    [state](HRESULT hr, ICoreWebView2Controller* controller) -> HRESULT {
                        if (state->closed) { if (controller) controller->Close(); return E_ABORT; }
                        if (FAILED(hr)) { state->finished = true; state->result = 4; return hr; }
                        state->controller = controller;
                        controller->get_CoreWebView2(&state->web);
                        RECT bounds; GetClientRect(state->window, &bounds); controller->put_Bounds(bounds);
                        EventRegistrationToken token;
                        state->web->add_WebMessageReceived(
                            Microsoft::WRL::Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                            [state](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                                LPWSTR message = nullptr;
                                args->TryGetWebMessageAsString(&message);
                                if (message && wcscmp(message, L"first-contentful-paint") == 0) {
                                    state->finished = true; state->result = 0;
                                }
                                CoTaskMemFree(message); return S_OK;
                            }).Get(), &token);
                        return state->web->NavigateToString(
                            L"<!doctype html><style>body{background:#191411;color:white}</style><h1>Ready</h1>"
                            L"<script>new PerformanceObserver(list=>{for(const e of list.getEntries())"
                            L"chrome.webview.postMessage(e.name);}).observe({type:'paint',buffered:true});</script>");
                    }).Get());
                if (FAILED(created)) { state->finished = true; state->result = 5; }
                return created;
            }).Get());
        if (SUCCEEDED(started)) {
            state->result = 6; // A hidden, uncomposited WebView would time out here.
            ULONGLONG deadline = GetTickCount64() + 15000;
            while (!state->finished && GetTickCount64() < deadline) {
                MSG message;
                while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
                    TranslateMessage(&message); DispatchMessageW(&message);
                }
                MsgWaitForMultipleObjectsEx(0, nullptr, 20, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
            }
        } else state->result = 5;
        if (!verifyCloaked() || GetForegroundWindow() == state->window) state->result = 7;
        if (FAILED(Headroom_CompleteWindowStartup(state->window, FALSE))) state->result = 8;
        DWORD cloak = 0;
        DwmGetWindowAttribute(state->window, DWMWA_CLOAKED, &cloak, sizeof(cloak));
        if (IsWindowVisible(state->window) || cloak || GetWindowLongPtrW(state->window, GWL_EXSTYLE) != originalStyle)
            state->result = 9;
        if (Headroom_CompleteWindowStartup(state->window, TRUE) != S_FALSE || IsWindowVisible(state->window)) state->result = 10;
    }
    state->closed = true;
    if (state->controller) state->controller->Close();
    state->web.Reset(); state->controller.Reset();
    if (state->window) DestroyWindow(state->window);
    CoUninitialize();
    return state->result;
}
