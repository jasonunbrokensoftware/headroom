#include "Headroom.Linux.h"
#include <dlfcn.h>
#include <initializer_list>

namespace {
GtkWidget* window = nullptr;
bool starting = true;
using Action = void (*)(int);
Action action = nullptr;
GtkWidget* menu = nullptr;
GtkWidget* startup = nullptr;
gulong startupSignal = 0;
void* indicatorLibrary = nullptr;
gpointer indicator = nullptr;
void (*setStatus)(gpointer, int) = nullptr;
GtkStatusIcon* legacyIcon = nullptr;
GDBusConnection* bus = nullptr;
guint watcher = 0;
bool watcherPresent = false;

void dispatch(GtkWidget*, gpointer command) { if (action) action(GPOINTER_TO_INT(command)); }
void addItem(const char* label, int command) {
    GtkWidget* item = gtk_menu_item_new_with_label(label);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), item);
    g_signal_connect(item, "activate", G_CALLBACK(dispatch), GINT_TO_POINTER(command));
}
void watcherAppeared(GDBusConnection*, const gchar*, const gchar*, gpointer) {
    watcherPresent = true; if (action) action(6);
}
void watcherVanished(GDBusConnection*, const gchar*, gpointer) {
    watcherPresent = false; if (action) action(6);
}
}

void Headroom_BeginLinuxStartup(GtkWidget* host) {
    window = host;
    starting = true;
    // decorated=false alone does not announce client-side decorations on
    // Wayland: GTK can still ask KWin for a server title bar. A custom titlebar
    // opts into client decorations before realization; keep its placeholder
    // hidden because Vue already draws the entire frame.
    GtkWidget* titlebar = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
    gtk_widget_set_no_show_all(titlebar, TRUE);
    gtk_window_set_titlebar(GTK_WINDOW(window), titlebar);
    gtk_window_set_decorated(GTK_WINDOW(window), FALSE);
    // A mapped WebKit view renders while its GTK surface is transparent.
    // Keep the temporary surface out of task switching and unable to take focus.
    gtk_widget_set_opacity(window, 0);
    gtk_window_set_skip_taskbar_hint(GTK_WINDOW(window), TRUE);
    gtk_window_set_skip_pager_hint(GTK_WINDOW(window), TRUE);
    gtk_window_set_accept_focus(GTK_WINDOW(window), FALSE);
    gtk_widget_realize(window);
    cairo_region_t* empty = cairo_region_create();
    gtk_widget_input_shape_combine_region(window, empty);
    cairo_region_destroy(empty);
}

extern "C" void Headroom_LinuxShow() {
    if (!window || starting) return;
    gtk_widget_show_all(window);
    gtk_window_deiconify(GTK_WINDOW(window));
    gtk_window_present(GTK_WINDOW(window));
}
extern "C" void Headroom_LinuxHide() { if (window) gtk_widget_hide(window); }
extern "C" void Headroom_LinuxCompleteStartup(int reveal) {
    if (!window || !starting) return;
    gtk_widget_hide(window);
    gtk_widget_input_shape_combine_region(window, nullptr);
    gtk_widget_set_opacity(window, 1);
    gtk_window_set_skip_taskbar_hint(GTK_WINDOW(window), FALSE);
    gtk_window_set_skip_pager_hint(GTK_WINDOW(window), FALSE);
    gtk_window_set_accept_focus(GTK_WINDOW(window), TRUE);
    starting = false;
    if (reveal) Headroom_LinuxShow();
}

extern "C" int Headroom_LinuxTrayAvailable() {
    return (indicator && watcherPresent) || (legacyIcon && gtk_status_icon_is_embedded(legacyIcon));
}
extern "C" void Headroom_LinuxTraySetStartup(int enabled) {
    if (!startup) return;
    g_signal_handler_block(startup, startupSignal);
    gtk_check_menu_item_set_active(GTK_CHECK_MENU_ITEM(startup), enabled != 0);
    g_signal_handler_unblock(startup, startupSignal);
}
extern "C" void Headroom_LinuxTrayCreate(const char* icon, int autoStart, Action callback) {
    action = callback;
    menu = gtk_menu_new();
    g_object_ref_sink(menu);
    addItem("Open Headroom", 1);
    addItem("Refresh all accounts", 2);
    startup = gtk_check_menu_item_new_with_label("Start at login");
    gtk_check_menu_item_set_active(GTK_CHECK_MENU_ITEM(startup), autoStart != 0);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), startup);
    startupSignal = g_signal_connect(startup, "toggled", G_CALLBACK(dispatch), GINT_TO_POINTER(3));
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), gtk_separator_menu_item_new());
    addItem("About Headroom", 5);
    addItem("Quit Headroom", 4);
    gtk_widget_show_all(menu);

    // Both implementations expose the same ABI. Keep indicator support optional
    // so desktops without it can still open/close Headroom normally.
    for (const char* library : {"libayatana-appindicator3.so.1", "libappindicator3.so.1"}) {
        indicatorLibrary = dlopen(library, RTLD_NOW | RTLD_LOCAL);
        if (indicatorLibrary) break;
    }
    if (indicatorLibrary) {
        auto create = reinterpret_cast<gpointer (*)(const char*, const char*, int)>(dlsym(indicatorLibrary, "app_indicator_new"));
        auto setMenu = reinterpret_cast<void (*)(gpointer, GtkMenu*)>(dlsym(indicatorLibrary, "app_indicator_set_menu"));
        setStatus = reinterpret_cast<void (*)(gpointer, int)>(dlsym(indicatorLibrary, "app_indicator_set_status"));
        if (create && setMenu && setStatus) {
            indicator = create("headroom", icon, 0); // APPLICATION_STATUS
            setMenu(indicator, GTK_MENU(menu));
            setStatus(indicator, 1); // ACTIVE
            bus = g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, nullptr);
            if (bus) {
                GVariant* reply = g_dbus_connection_call_sync(bus, "org.freedesktop.DBus", "/org/freedesktop/DBus",
                    "org.freedesktop.DBus", "NameHasOwner", g_variant_new("(s)", "org.kde.StatusNotifierWatcher"),
                    G_VARIANT_TYPE("(b)"), G_DBUS_CALL_FLAGS_NONE, 1000, nullptr, nullptr);
                if (reply) { gboolean present; g_variant_get(reply, "(b)", &present); watcherPresent = present; g_variant_unref(reply); }
                watcher = g_bus_watch_name_on_connection(bus, "org.kde.StatusNotifierWatcher", G_BUS_NAME_WATCHER_FLAGS_NONE,
                    watcherAppeared, watcherVanished, nullptr, nullptr);
            }
        }
    }
    if (!indicator) {
        legacyIcon = gtk_status_icon_new_from_file(icon);
        gtk_status_icon_set_tooltip_text(legacyIcon, "Headroom — monitoring account-wide usage");
        g_signal_connect(legacyIcon, "activate", G_CALLBACK(+[](GtkStatusIcon*, gpointer) { if (action) action(1); }), nullptr);
        g_signal_connect(legacyIcon, "popup-menu", G_CALLBACK(+[](GtkStatusIcon* icon, guint button, guint time, gpointer) {
            gtk_menu_popup(GTK_MENU(menu), nullptr, nullptr, gtk_status_icon_position_menu, icon, button, time);
        }), nullptr);
        gtk_status_icon_set_visible(legacyIcon, TRUE);
    }
}
extern "C" void Headroom_LinuxTrayDestroy() {
    action = nullptr;
    if (watcher) { g_bus_unwatch_name(watcher); watcher = 0; }
    if (bus) { g_object_unref(bus); bus = nullptr; }
    if (indicator) { setStatus(indicator, 0); g_object_unref(indicator); indicator = nullptr; }
    if (legacyIcon) { gtk_status_icon_set_visible(legacyIcon, FALSE); g_object_unref(legacyIcon); legacyIcon = nullptr; }
    if (menu) { gtk_widget_destroy(menu); g_object_unref(menu); menu = nullptr; startup = nullptr; }
    // GObject types registered by the indicator library live for the process.
    // Do not dlclose it while their type metadata can still be referenced.
}
extern "C" void Headroom_LinuxError(const char* text) {
    auto dialog = gtk_message_dialog_new(GTK_WINDOW(window), GTK_DIALOG_DESTROY_WITH_PARENT,
        GTK_MESSAGE_ERROR, GTK_BUTTONS_CLOSE, "%s", text);
    g_signal_connect(dialog, "response", G_CALLBACK(+[](GtkDialog* dialog, gint, gpointer) { gtk_widget_destroy(GTK_WIDGET(dialog)); }), nullptr);
    gtk_widget_show(dialog);
}

// Read-only flags used by isolated desktop regression tests. No screen capture.
extern "C" int Headroom_LinuxWindowState() {
    if (!window) return 0;
    return (starting ? 1 : 0) | (gtk_widget_get_visible(window) ? 2 : 0) |
        (gtk_widget_get_opacity(window) == 0 ? 4 : 0) |
        (gtk_window_get_skip_taskbar_hint(GTK_WINDOW(window)) ? 8 : 0) |
        (Headroom_LinuxTrayAvailable() ? 16 : 0) |
        (gtk_window_get_decorated(GTK_WINDOW(window)) ? 32 : 0) |
        (gtk_window_get_titlebar(GTK_WINDOW(window)) &&
            gtk_widget_get_visible(gtk_window_get_titlebar(GTK_WINDOW(window))) ? 64 : 0);
}
extern "C" void Headroom_LinuxTestMenu(int command) {
    if (command == 3 && startup) gtk_menu_item_activate(GTK_MENU_ITEM(startup));
    else if (action) action(command);
}
