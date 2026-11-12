namespace Headroom;

internal interface IDesktopTray : IDisposable
{
    bool Available { get; }
    void Show();
    void Hide();
}
