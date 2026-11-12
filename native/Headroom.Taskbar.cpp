#include <windows.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <propkey.h>
#include <propvarutil.h>
#include <wrl/client.h>
#include <string>
#include <vector>

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

HRESULT ClearRelaunchProperties(IPropertyStore* store) {
    PROPVARIANT empty;
    PropVariantInit(&empty);
    for (const auto& key : { PKEY_AppUserModel_RelaunchCommand, PKEY_AppUserModel_RelaunchDisplayNameResource,
        PKEY_AppUserModel_RelaunchIconResource }) {
        HRESULT result = store->SetValue(key, empty);
        if (FAILED(result)) return result;
    }
    return S_OK;
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

// SHUpdateImage requires the OLD extractor location/index/flags, plus its system
// image-list index. Capture these before changing the file or shortcut, never
// substitute an assumed index or broadcast a global icon-cache reset.
// https://learn.microsoft.com/windows/win32/api/shlobj_core/nf-shlobj_core-shupdateimagew
struct CachedImage {
    wchar_t file[32768] = {};
    int index = 0, imageIndex = -1;
    UINT flags = 0;

    bool Capture(const wchar_t* path) {
        PIDLIST_ABSOLUTE pidl = nullptr;
        if (FAILED(SHParseDisplayName(path, nullptr, &pidl, 0, nullptr))) return false;
        ComPtr<IShellFolder> parent;
        PCUITEMID_CHILD child = nullptr;
        HRESULT result = SHBindToParent(pidl, IID_PPV_ARGS(&parent), &child);
        ComPtr<IExtractIconW> extractor;
        if (SUCCEEDED(result)) result = parent->GetUIObjectOf(nullptr, 1, &child, IID_IExtractIconW,
            nullptr, reinterpret_cast<void**>(extractor.GetAddressOf()));
        if (SUCCEEDED(result)) result = extractor->GetIconLocation(0, file, ARRAYSIZE(file), &index, &flags);
        CoTaskMemFree(pidl);
        if (result != S_OK) return false;
        SHFILEINFOW info = {};
        if (!SHGetFileInfoW(path, 0, &info, sizeof(info), SHGFI_SYSICONINDEX)) return false;
        imageIndex = info.iIcon;
        return true;
    }

    void Notify() const {
        if (imageIndex >= 0) SHUpdateImageW(file, index, flags, imageIndex);
    }
};

HRESULT LoadShortcut(const wchar_t* path, ComPtr<IShellLinkW>& link, ComPtr<IPersistFile>& file, DWORD mode) {
    HRESULT result = CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&link));
    if (FAILED(result) || FAILED(result = link.As(&file))) return result;
    return file->Load(path, mode);
}

// Inspect only existing per-user launch locations; never create pins or follow
// directory junctions. A matching executable path is required, not a link name.
HRESULT FindShortcuts(const std::wstring& directory, const wchar_t* executable, bool recursive,
    std::vector<std::wstring>& shortcuts) {
    if (directory.empty()) return S_OK;
    WIN32_FIND_DATAW found;
    HANDLE search = FindFirstFileW((directory + L"\\*").c_str(), &found);
    if (search == INVALID_HANDLE_VALUE) {
        DWORD error = GetLastError();
        return error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND ? S_OK : HRESULT_FROM_WIN32(error);
    }
    HRESULT result = S_OK;
    do {
        auto path = directory + L"\\" + found.cFileName;
        if (found.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
            if (recursive && !(found.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) &&
                wcscmp(found.cFileName, L".") && wcscmp(found.cFileName, L"..")) {
                result = FindShortcuts(path, executable, true, shortcuts);
                if (FAILED(result)) break;
            }
            continue;
        }
        if (path.size() < 4 || _wcsicmp(path.c_str() + path.size() - 4, L".lnk")) continue;
        ComPtr<IShellLinkW> link;
        ComPtr<IPersistFile> file;
        if (FAILED(LoadShortcut(path.c_str(), link, file, STGM_READ))) continue;
        wchar_t target[32768] = {};
        if (SUCCEEDED(link->GetPath(target, ARRAYSIZE(target), nullptr, SLGP_RAWPATH)) && SamePath(target, executable))
            shortcuts.push_back(path);
    } while (FindNextFileW(search, &found));
    FindClose(search);
    return result;
}

HRESULT UpdateShortcut(const wchar_t* shortcut, const wchar_t* icon) {
    ComPtr<IShellLinkW> link;
    ComPtr<IPersistFile> file;
    HRESULT result = LoadShortcut(shortcut, link, file, STGM_READWRITE);
    if (FAILED(result)) return result;
    // Keep target, arguments, working directory, description and pin position.
    if (FAILED(result = link->SetIconLocation(icon, 0))) return result;
    ComPtr<IPropertyStore> store;
    if (FAILED(result = link.As(&store))) return result;
    // Microsoft specifies shortcut icon/command properties when a launch link
    // exists. Remove the redundant relaunch properties written by older builds.
    // https://learn.microsoft.com/windows/win32/shell/appids
    if (FAILED(result = ClearRelaunchProperties(store.Get()))) return result;
    if (FAILED(result = SetText(store.Get(), PKEY_AppUserModel_ID, AppId))) return result;
    if (FAILED(result = store->Commit())) return result;
    return file->Save(shortcut, TRUE);
}

HRESULT SetWindowProperties(HWND window, const wchar_t* executable, const wchar_t* icon, bool hasShortcut) {
    ComPtr<IPropertyStore> store;
    HRESULT result = SHGetPropertyStoreForWindow(window, IID_PPV_ARGS(&store));
    if (FAILED(result)) return result;
    if (hasShortcut) {
        if (FAILED(result = ClearRelaunchProperties(store.Get()))) return result;
    } else {
        if (FAILED(result = SetText(store.Get(), PKEY_AppUserModel_RelaunchCommand, L"\"" + std::wstring(executable) + L"\""))) return result;
        if (FAILED(result = SetText(store.Get(), PKEY_AppUserModel_RelaunchDisplayNameResource, L"Headroom"))) return result;
        // Microsoft's documented direct-ICO resource format includes index zero.
        // https://learn.microsoft.com/windows/win32/properties/props-system-appusermodel-relaunchiconresource
        if (FAILED(result = SetText(store.Get(), PKEY_AppUserModel_RelaunchIconResource, std::wstring(icon) + L",0"))) return result;
    }
    // Set identity last to notify the taskbar that its metadata has changed.
    // https://learn.microsoft.com/windows/win32/properties/props-system-appusermodel-id
    return SetText(store.Get(), PKEY_AppUserModel_ID, AppId);
}
}

extern "C" HRESULT Headroom_SetTaskbarIcon(HWND window, const wchar_t* executable, const wchar_t* icon,
    const wchar_t* pinnedDirectory, const wchar_t* desktopDirectory, const wchar_t* startMenuDirectory) {
    Apartment apartment;
    if (FAILED(apartment.Status())) return apartment.Status();
    // Identity must be established before any UI even if a shortcut is locked.
    HRESULT result = window ? S_OK : SetCurrentProcessExplicitAppUserModelID(AppId);
    if (FAILED(result)) return result;
    std::vector<std::wstring> shortcuts;
    if (FAILED(result = FindShortcuts(pinnedDirectory, executable, false, shortcuts)) ||
        FAILED(result = FindShortcuts(desktopDirectory, executable, false, shortcuts)) ||
        FAILED(result = FindShortcuts(startMenuDirectory, executable, true, shortcuts))) return result;

    std::vector<CachedImage> oldImages;
    for (const auto& shortcut : shortcuts) {
        CachedImage previous;
        if (previous.Capture(shortcut.c_str())) oldImages.push_back(previous);
    }

    // Use the immutable per-theme ICO, avoiding stale readers of an overwritten
    // icon file. Shell consumers can retain decoded images for a resource path.
    HRESULT shortcutResult = S_OK;
    for (const auto& shortcut : shortcuts) {
        HRESULT updated = UpdateShortcut(shortcut.c_str(), icon);
        if (FAILED(updated) && SUCCEEDED(shortcutResult)) shortcutResult = updated;
    }
    for (const auto& previous : oldImages) previous.Notify();
    for (const auto& shortcut : shortcuts)
        SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW | SHCNF_FLUSH, shortcut.c_str(), nullptr);
    if (FAILED(shortcutResult)) return shortcutResult;

    // Do not hide/show, change placement or remove/re-add a taskbar button here.
    // Those operations disturb Snap and do not establish icon correctness.
    return window ? SetWindowProperties(window, executable, icon, !shortcuts.empty()) : S_OK;
}

extern "C" void Headroom_ClearTaskbarIcon(HWND window) {
    Apartment apartment;
    if (FAILED(apartment.Status())) return;
    ComPtr<IPropertyStore> store;
    if (FAILED(SHGetPropertyStoreForWindow(window, IID_PPV_ARGS(&store)))) return;
    ClearRelaunchProperties(store.Get());
    PROPVARIANT empty;
    PropVariantInit(&empty);
    store->SetValue(PKEY_AppUserModel_ID, empty);
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

bool IsEmpty(IPropertyStore* store, REFPROPERTYKEY key) {
    PROPVARIANT value;
    PropVariantInit(&value);
    HRESULT result = store->GetValue(key, &value);
    bool empty = SUCCEEDED(result) && value.vt == VT_EMPTY;
    PropVariantClear(&value);
    return empty;
}

bool CheckTestShortcut(const wchar_t* path, const wchar_t* executable, const wchar_t* icon, const wchar_t* workingDirectory, bool migrated) {
    ComPtr<IShellLinkW> link;
    ComPtr<IPersistFile> file;
    if (FAILED(LoadShortcut(path, link, file, STGM_READ))) return false;
    wchar_t value[32768]; int index;
    if (FAILED(link->GetPath(value, ARRAYSIZE(value), nullptr, SLGP_RAWPATH)) || !SamePath(value, executable)) return false;
    if (FAILED(link->GetIconLocation(value, ARRAYSIZE(value), &index)) || index != 0 || !SamePath(value, icon)) return false;
    if (FAILED(link->GetWorkingDirectory(value, ARRAYSIZE(value))) || !SamePath(value, workingDirectory)) return false;
    if (FAILED(link->GetArguments(value, ARRAYSIZE(value))) || wcscmp(value, L"--background")) return false;
    if (FAILED(link->GetDescription(value, ARRAYSIZE(value))) || wcscmp(value, L"Preserve this description")) return false;
    ComPtr<IPropertyStore> store;
    if (FAILED(link.As(&store))) return false;
    return (migrated ? HasText(store.Get(), PKEY_AppUserModel_ID, AppId) : IsEmpty(store.Get(), PKEY_AppUserModel_ID)) &&
        IsEmpty(store.Get(), PKEY_AppUserModel_RelaunchIconResource);
}

// Render returned HICONs into memory (never capture the screen). Compare the
// center so the shortcut-arrow overlay does not obscure the selected artwork.
std::vector<DWORD> IconPixels(HICON icon) {
    std::vector<DWORD> pixels;
    if (!icon) return pixels;
    BITMAPINFO info = {};
    info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = 32; info.bmiHeader.biHeight = -32;
    info.bmiHeader.biPlanes = 1; info.bmiHeader.biBitCount = 32; info.bmiHeader.biCompression = BI_RGB;
    void* bits = nullptr;
    HBITMAP bitmap = CreateDIBSection(nullptr, &info, DIB_RGB_COLORS, &bits, nullptr, 0);
    HDC dc = CreateCompatibleDC(nullptr);
    if (bitmap && dc) {
        auto old = SelectObject(dc, bitmap);
        ZeroMemory(bits, 32 * 32 * sizeof(DWORD));
        if (DrawIconEx(dc, 0, 0, icon, 32, 32, 0, nullptr, DI_NORMAL)) {
            GdiFlush();
            for (int y = 6; y < 18; ++y) for (int x = 6; x < 26; ++x)
                pixels.push_back(static_cast<DWORD*>(bits)[y * 32 + x]);
        }
        SelectObject(dc, old);
    }
    if (dc) DeleteDC(dc);
    if (bitmap) DeleteObject(bitmap);
    return pixels;
}

bool ShellIconMatches(const wchar_t* shortcut, const wchar_t* themeIcon) {
    SHFILEINFOW info = {};
    auto diagnostic = [](const std::string& text) {
        DWORD written;
        WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), text.data(), static_cast<DWORD>(text.size()), &written, nullptr);
    };
    if (!SHGetFileInfoW(shortcut, 0, &info, sizeof(info), SHGFI_ICON | SHGFI_LARGEICON)) {
        diagnostic("Shell extraction failed: " + std::to_string(GetLastError()) + "\n");
        return false;
    }
    // The Shell chooses its frame size from the process DPI context. Decode the
    // same frame so this comparison measures artwork, not different resampling.
    ICONINFO iconInfo = {};
    BITMAP bitmap = {};
    if (GetIconInfo(info.hIcon, &iconInfo)) {
        GetObjectW(iconInfo.hbmColor, sizeof(bitmap), &bitmap);
        if (iconInfo.hbmColor) DeleteObject(iconInfo.hbmColor);
        if (iconInfo.hbmMask) DeleteObject(iconInfo.hbmMask);
    }
    HICON expected = static_cast<HICON>(LoadImageW(nullptr, themeIcon, IMAGE_ICON, bitmap.bmWidth, bitmap.bmHeight, LR_LOADFROMFILE));
    auto pixels = IconPixels(expected);
    if (expected) DestroyIcon(expected);
    auto actual = IconPixels(info.hIcon);
    if (info.hIcon) DestroyIcon(info.hIcon);
    if (pixels != actual || pixels.empty()) {
        diagnostic("Shell icon mismatch: frame " + std::to_string(bitmap.bmWidth) + ", expected samples " +
            std::to_string(pixels.size()) + ", actual samples " + std::to_string(actual.size()) + "\n");
        for (size_t i = 0; i < pixels.size() && i < actual.size(); ++i) if (pixels[i] != actual[i]) {
            diagnostic("First differing pixel " + std::to_string(i) + ": expected " + std::to_string(pixels[i]) +
                ", actual " + std::to_string(actual[i]) + "\n");
            break;
        }
    }
    return !pixels.empty() && pixels == actual;
}
}

// Test the Shell's returned icon pixels as well as shortcut metadata. This is
// still not a test of Explorer's visible grouped button: that requires user QA.
// Only scratch links and a message-only HWND are used, never real launch links.
extern "C" int Headroom_TestTaskbarIcons(const wchar_t* directory, const wchar_t* executable, const wchar_t* firstIcon, const wchar_t* secondIcon) {
    Apartment apartment;
    if (FAILED(apartment.Status())) return 1;
    auto matching = std::wstring(directory) + L"\\Renamed pin.lnk";
    auto desktop = std::wstring(directory) + L"\\Desktop";
    auto start = std::wstring(directory) + L"\\Start menu";
    auto programs = start + L"\\Programs";
    CreateDirectoryW(desktop.c_str(), nullptr); CreateDirectoryW(start.c_str(), nullptr); CreateDirectoryW(programs.c_str(), nullptr);
    auto desktopLink = desktop + L"\\Headroom.lnk";
    auto startLink = programs + L"\\Headroom.lnk";
    auto other = std::wstring(directory) + L"\\Headroom.lnk";
    auto otherExecutable = std::wstring(directory) + L"\\Another install\\Headroom.exe";
    for (const auto& link : { matching, desktopLink, startLink })
        if (FAILED(CreateTestShortcut(link.c_str(), executable, firstIcon, directory))) return 2;
    if (FAILED(CreateTestShortcut(other.c_str(), otherExecutable.c_str(), firstIcon, directory))) return 3;
    HWND window = CreateWindowExW(0, L"STATIC", L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, GetModuleHandleW(nullptr), nullptr);
    if (!window) return 4;
    int failure = 0;
    for (auto icon : { secondIcon, firstIcon, secondIcon }) {
        // Warm the Shell cache before each replacement, including switching back.
        SHFILEINFOW cached = {};
        SHGetFileInfoW(matching.c_str(), 0, &cached, sizeof(cached), SHGFI_SYSICONINDEX);
        HRESULT result = Headroom_SetTaskbarIcon(window, executable, icon, directory, desktop.c_str(), start.c_str());
        if (FAILED(result)) { failure = result; break; }
        // Shell change delivery is asynchronous. The real app has a native UI
        // message loop; this headless fixture must also dispatch notifications.
        ULONGLONG deadline = GetTickCount64() + 500;
        do {
            MSG message;
            while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            MsgWaitForMultipleObjectsEx(0, nullptr, 10, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
        } while (GetTickCount64() < deadline);
        for (const auto& link : { matching, desktopLink, startLink }) {
            if (!CheckTestShortcut(link.c_str(), executable, icon, directory, true)) { failure = 6; break; }
            if (!ShellIconMatches(link.c_str(), icon)) { failure = 10; break; }
        }
        if (failure) break;
        if (!CheckTestShortcut(other.c_str(), otherExecutable.c_str(), firstIcon, directory, false)) { failure = 7; break; }
        ComPtr<IPropertyStore> store;
        if (FAILED(SHGetPropertyStoreForWindow(window, IID_PPV_ARGS(&store))) ||
            !HasText(store.Get(), PKEY_AppUserModel_ID, AppId) ||
            !IsEmpty(store.Get(), PKEY_AppUserModel_RelaunchIconResource) ||
            !IsEmpty(store.Get(), PKEY_AppUserModel_RelaunchCommand)) { failure = 8; break; }
        CachedImage image;
        if (!image.Capture(matching.c_str()) || !SamePath(image.file, icon)) { failure = 11; break; }
        if (IsWindowVisible(window)) { failure = 9; break; }
    }
    // Portable launch without any shortcut: use Microsoft's documented resource
    // syntax, and remove it when a matching launch shortcut becomes available.
    if (!failure) {
        ComPtr<IPropertyStore> store;
        if (FAILED(Headroom_SetTaskbarIcon(window, executable, firstIcon, L"", L"", L"")) ||
            FAILED(SHGetPropertyStoreForWindow(window, IID_PPV_ARGS(&store))) ||
            !HasText(store.Get(), PKEY_AppUserModel_RelaunchIconResource, std::wstring(firstIcon) + L",0") ||
            !HasText(store.Get(), PKEY_AppUserModel_RelaunchCommand, L"\"" + std::wstring(executable) + L"\"")) failure = 12;
        if (!failure && (FAILED(Headroom_SetTaskbarIcon(window, executable, secondIcon, directory, desktop.c_str(), start.c_str())) ||
            !IsEmpty(store.Get(), PKEY_AppUserModel_RelaunchIconResource) ||
            !IsEmpty(store.Get(), PKEY_AppUserModel_RelaunchCommand))) failure = 13;
    }
    Headroom_ClearTaskbarIcon(window);
    DestroyWindow(window);
    return failure;
}
