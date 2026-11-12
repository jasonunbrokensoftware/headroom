namespace Headroom;

// Shared policy; native window operations remain in their platform adapters.
internal sealed class StartupVisibility(bool background)
{
    internal bool Painted { get; private set; }
    internal bool ShowRequested { get; private set; } = !background;
    internal bool RequestShow() { ShowRequested = true; return Painted; }
    internal bool CompletePaint() { Painted = true; return ShowRequested; }
}
