#include "photino/Photino.h"
// Exercises both statically linked components without creating a desktop window.
extern "C" int Headroom_WebViewRuntimeAvailable()
{
    LPWSTR version = nullptr;
    HRESULT result = GetAvailableCoreWebView2BrowserVersionString(nullptr, &version);
    bool available = SUCCEEDED(result) && version != nullptr;
    CoTaskMemFree(version);
    return available ? 1 : 0;
}
