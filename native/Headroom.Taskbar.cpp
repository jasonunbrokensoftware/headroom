#include <windows.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <propkey.h>
#include <propvarutil.h>
#include <wrl/client.h>
#include <string>

using Microsoft::WRL::ComPtr;

namespace {
constexpr wchar_t AppId[] = L"Headroom.Desktop";

class Apartment {
    HRESULT result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
public:
    ~Apartment() { if (SUCCEEDED(result)) CoUninitialize(); }
    HRESULT Status() const { return result == RPC_E_CHANGED_MODE ? S_OK : result; }
};

HRESULT SetText(IPropertyStore* store, REFPROPERTYKEY key, const std::wstring& text) {
    PROPVARIANT value;
    HRESULT result = InitPropVariantFromString(text.c_str(), &value);
    if (FAILED(result)) return result;
    result = store->SetValue(key, value);
    PropVariantClear(&value);
    return result;
}

std::wstring FullPath(const wchar_t* path) {
    DWORD size = GetFullPathNameW(path, 0, nullptr, nullptr);
    if (!size) return {};
    std::wstring full(size, L'\0');
    DWORD length = GetFullPathNameW(path, size, &full[0], nullptr);
    if (!length || length >= size) return {};
    full.resize(length);
    return full;
}

bool SamePath(const wchar_t* left, const wchar_t* right) {
    auto a = FullPath(left), b = FullPath(right);
    return !a.empty() && !b.empty() && CompareStringOrdinal(a.c_str(), -1, b.c_str(), -1, TRUE) == CSTR_EQUAL;
}

HRESULT UpdateShortcut(const wchar_t* shortcut, const wchar_t* executable, const wchar_t* icon) {
    ComPtr<IShellLinkW> link;
    HRESULT result = CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&link));
    if (FAILED(result)) return result;
    ComPtr<IPersistFile> file;
    result = link.As(&file);
    if (FAILED(result)) return result;
    result = file->Load(shortcut, STGM_READ);
    if (FAILED(result)) return S_FALSE; // An unrelated unreadable link must not block a theme change.
    wchar_t target[32768] = {};
    if (FAILED(link->GetPath(target, ARRAYSIZE(target), nullptr, SLGP_RAWPATH)) || !SamePath(target, executable))
        return S_FALSE;
    result = file->Load(shortcut, STGM_READWRITE);
    if (FAILED(result)) return result;

    // Change only the icon and app identity of an existing pin for this EXE.
    // Preserve its arguments, working directory, description, and pinned position.
    result = link->SetIconLocation(icon, 0);
    if (FAILED(result)) return result;
    ComPtr<IPropertyStore> store;
    result = link.As(&store);
    if (FAILED(result)) return result;
    result = SetText(store.Get(), PKEY_AppUserModel_RelaunchIconResource, std::wstring(icon) + L",0");
    if (FAILED(result)) return result;
    result = SetText(store.Get(), PKEY_AppUserModel_ID, AppId);
    if (FAILED(result)) return result;
    result = store->Commit();
    if (FAILED(result)) return result;
    result = file->Save(shortcut, TRUE);
    if (SUCCEEDED(result)) SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW | SHCNF_FLUSH, shortcut, nullptr);
    return result;
}

HRESULT UpdatePinnedShortcuts(const wchar_t* directory, const wchar_t* executable, const wchar_t* icon) {
    WIN32_FIND_DATAW found;
    HANDLE search = FindFirstFileW((std::wstring(directory) + L"\\*.lnk").c_str(), &found);
    if (search == INVALID_HANDLE_VALUE) {
        DWORD error = GetLastError();
        return error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND ? S_OK : HRESULT_FROM_WIN32(error);
    }
    HRESULT result = S_OK;
    do {
        if (found.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue;
        result = UpdateShortcut((std::wstring(directory) + L"\\" + found.cFileName).c_str(), executable, icon);
        if (FAILED(result)) break;
    } while (FindNextFileW(search, &found));
    FindClose(search);
    return FAILED(result) ? result : S_OK;
}

HRESULT SetWindowProperties(HWND window, const wchar_t* executable, const wchar_t* icon) {
    ComPtr<IPropertyStore> store;
    HRESULT result = SHGetPropertyStoreForWindow(window, IID_PPV_ARGS(&store));
    if (FAILED(result)) return result;
    result = SetText(store.Get(), PKEY_AppUserModel_RelaunchCommand, L"\"" + std::wstring(executable) + L"\"");
    if (FAILED(result)) return result;
    result = SetText(store.Get(), PKEY_AppUserModel_RelaunchDisplayNameResource, L"Headroom");
    if (FAILED(result)) return result;
    result = SetText(store.Get(), PKEY_AppUserModel_RelaunchIconResource, std::wstring(icon) + L",0");
    if (FAILED(result)) return result;
    // Set the stable identity LAST: this notifies the taskbar to refresh its
    // group icon. WM_SETICON alone updates a window, not a pinned taskbar group.
    // https://learn.microsoft.com/windows/win32/properties/props-system-appusermodel-id
    return SetText(store.Get(), PKEY_AppUserModel_ID, AppId);
}
}

extern "C" HRESULT Headroom_SetTaskbarIcon(HWND window, const wchar_t* executable, const wchar_t* icon, const wchar_t* pinnedDirectory) {
    Apartment apartment;
    if (FAILED(apartment.Status())) return apartment.Status();
    HRESULT result = UpdatePinnedShortcuts(pinnedDirectory, executable, icon);
    if (FAILED(result)) return result;
    return window ? SetWindowProperties(window, executable, icon) : SetCurrentProcessExplicitAppUserModelID(AppId);
}

extern "C" void Headroom_ClearTaskbarIcon(HWND window) {
    Apartment apartment;
    if (FAILED(apartment.Status())) return;
    ComPtr<IPropertyStore> store;
    if (FAILED(SHGetPropertyStoreForWindow(window, IID_PPV_ARGS(&store)))) return;
    PROPVARIANT empty;
    PropVariantInit(&empty);
    for (const auto& key : { PKEY_AppUserModel_RelaunchCommand, PKEY_AppUserModel_RelaunchDisplayNameResource,
        PKEY_AppUserModel_RelaunchIconResource, PKEY_AppUserModel_ID }) store->SetValue(key, empty);
}

namespace {
HRESULT CreateTestShortcut(const wchar_t* path, const wchar_t* executable, const wchar_t* icon, const wchar_t* workingDirectory) {
    ComPtr<IShellLinkW> link;
    HRESULT result = CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&link));
    if (FAILED(result)) return result;
    if (FAILED(result = link->SetPath(executable))) return result;
    if (FAILED(result = link->SetArguments(L"--background"))) return result;
    if (FAILED(result = link->SetWorkingDirectory(workingDirectory))) return result;
    if (FAILED(result = link->SetDescription(L"Preserve this description"))) return result;
    if (FAILED(result = link->SetIconLocation(icon, 0))) return result;
    ComPtr<IPersistFile> file;
    if (FAILED(result = link.As(&file))) return result;
    return file->Save(path, TRUE);
}

bool HasText(IPropertyStore* store, REFPROPERTYKEY key, const std::wstring& expected) {
    PROPVARIANT value;
    PropVariantInit(&value);
    HRESULT result = store->GetValue(key, &value);
    bool matches = SUCCEEDED(result) && value.vt == VT_LPWSTR && value.pwszVal && expected == value.pwszVal;
    PropVariantClear(&value);
    return matches;
}

bool CheckTestShortcut(const wchar_t* path, const wchar_t* executable, const wchar_t* icon, const wchar_t* workingDirectory, bool migrated) {
    ComPtr<IShellLinkW> link;
    ComPtr<IPersistFile> file;
    if (FAILED(CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&link))) ||
        FAILED(link.As(&file)) || FAILED(file->Load(path, STGM_READ))) return false;
    wchar_t value[32768]; int index;
    if (FAILED(link->GetPath(value, ARRAYSIZE(value), nullptr, SLGP_RAWPATH)) || !SamePath(value, executable)) return false;
    if (FAILED(link->GetIconLocation(value, ARRAYSIZE(value), &index)) || index != 0 || !SamePath(value, icon)) return false;
    if (FAILED(link->GetWorkingDirectory(value, ARRAYSIZE(value))) || !SamePath(value, workingDirectory)) return false;
    if (FAILED(link->GetArguments(value, ARRAYSIZE(value))) || wcscmp(value, L"--background")) return false;
    if (FAILED(link->GetDescription(value, ARRAYSIZE(value))) || wcscmp(value, L"Preserve this description")) return false;
    ComPtr<IPropertyStore> store;
    if (FAILED(link.As(&store))) return false;
    if (migrated) return HasText(store.Get(), PKEY_AppUserModel_ID, AppId) &&
        HasText(store.Get(), PKEY_AppUserModel_RelaunchIconResource, std::wstring(icon) + L",0");
    PROPVARIANT id;
    PropVariantInit(&id);
    HRESULT result = store->GetValue(PKEY_AppUserModel_ID, &id);
    bool unchanged = SUCCEEDED(result) && id.vt == VT_EMPTY;
    PropVariantClear(&id);
    return unchanged;
}
}

// Isolated regression test: scratch shortcuts and a message-only HWND, never a
// visible window, actual taskbar pin, registry update, or Explorer restart.
extern "C" int Headroom_TestTaskbarIcons(const wchar_t* directory, const wchar_t* executable, const wchar_t* firstIcon, const wchar_t* secondIcon) {
    Apartment apartment;
    if (FAILED(apartment.Status())) return 1;
    auto matching = std::wstring(directory) + L"\\Renamed pin.lnk";
    auto other = std::wstring(directory) + L"\\Headroom.lnk";
    auto otherExecutable = std::wstring(directory) + L"\\Another install\\Headroom.exe";
    if (FAILED(CreateTestShortcut(matching.c_str(), executable, firstIcon, directory))) return 2;
    if (FAILED(CreateTestShortcut(other.c_str(), otherExecutable.c_str(), firstIcon, directory))) return 3;
    HWND window = CreateWindowExW(0, L"STATIC", L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, GetModuleHandleW(nullptr), nullptr);
    if (!window) return 4;
    int failure = 0;
    for (auto icon : { secondIcon, firstIcon, secondIcon }) {
        HRESULT result = Headroom_SetTaskbarIcon(window, executable, icon, directory);
        if (FAILED(result)) { failure = result; break; }
        if (!CheckTestShortcut(matching.c_str(), executable, icon, directory, true)) { failure = 6; break; }
        if (!CheckTestShortcut(other.c_str(), otherExecutable.c_str(), firstIcon, directory, false)) { failure = 7; break; }
        ComPtr<IPropertyStore> store;
        if (FAILED(SHGetPropertyStoreForWindow(window, IID_PPV_ARGS(&store))) ||
            !HasText(store.Get(), PKEY_AppUserModel_ID, AppId) ||
            !HasText(store.Get(), PKEY_AppUserModel_RelaunchIconResource, std::wstring(icon) + L",0") ||
            !HasText(store.Get(), PKEY_AppUserModel_RelaunchDisplayNameResource, L"Headroom") ||
            !HasText(store.Get(), PKEY_AppUserModel_RelaunchCommand, L"\"" + std::wstring(executable) + L"\"")) { failure = 8; break; }
    }
    Headroom_ClearTaskbarIcon(window);
    DestroyWindow(window);
    return failure;
}
