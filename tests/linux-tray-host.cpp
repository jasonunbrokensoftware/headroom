// A private StatusNotifier host for tests under dbus-run-session and Xvfb.
// It does not connect to the user's desktop bus or panel.
#include <gio/gio.h>
#include <cstdio>
static const char* xml = R"(<node><interface name="org.kde.StatusNotifierWatcher">
<method name="RegisterStatusNotifierItem"><arg type="s" direction="in"/></method>
<method name="RegisterStatusNotifierHost"><arg type="s" direction="in"/></method>
<property name="RegisteredStatusNotifierItems" type="as" access="read"/>
<property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
<property name="ProtocolVersion" type="i" access="read"/>
<signal name="StatusNotifierItemRegistered"><arg type="s"/></signal>
<signal name="StatusNotifierHostRegistered"/>
</interface></node>)";
static void method(GDBusConnection*, const gchar*, const gchar*, const gchar*, const gchar* name,
    GVariant*, GDBusMethodInvocation* invocation, gpointer) {
    if (g_str_equal(name, "RegisterStatusNotifierItem")) { puts("REGISTERED"); fflush(stdout); }
    g_dbus_method_invocation_return_value(invocation, nullptr);
}
static GVariant* property(GDBusConnection*, const gchar*, const gchar*, const gchar*, const gchar* name, GError**, gpointer) {
    if (g_str_equal(name, "IsStatusNotifierHostRegistered")) return g_variant_new_boolean(TRUE);
    if (g_str_equal(name, "ProtocolVersion")) return g_variant_new_int32(0);
    return g_variant_new_strv(nullptr, 0);
}
int main() {
    GDBusConnection* bus = g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, nullptr);
    if (!bus) return 1;
    auto node = g_dbus_node_info_new_for_xml(xml, nullptr);
    const GDBusInterfaceVTable table = {method, property, nullptr};
    if (!g_dbus_connection_register_object(bus, "/StatusNotifierWatcher", node->interfaces[0], &table, nullptr, nullptr, nullptr)) return 2;
    g_bus_own_name_on_connection(bus, "org.kde.StatusNotifierWatcher", G_BUS_NAME_OWNER_FLAGS_NONE,
        +[](GDBusConnection*, const gchar*, gpointer) { puts("READY"); fflush(stdout); }, nullptr, nullptr, nullptr);
    g_main_loop_run(g_main_loop_new(nullptr, FALSE));
}
