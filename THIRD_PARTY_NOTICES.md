# Third-party notices

The root MIT license applies to Headroom's original code and artwork. It does not replace the licenses of third-party components.

| Component | License and notice |
| --- | --- |
| Vue 3.5.24 | MIT; [included license](src/Headroom/VUE-LICENSE.txt). The production library is vendored in `src/Headroom/wwwroot/vue.js`. |
| Photino.Native 4.0.22 | Apache-2.0; [included license](native/photino/LICENSE) and [pinned source and modification details](native/README.txt). |
| WinToast, bundled with Photino | MIT; copyright and license notices are retained in [wintoastlib.h](native/photino/Dependencies/wintoastlib.h) and [wintoastlib.cpp](native/photino/Dependencies/wintoastlib.cpp). |
| JSON for Modern C++, bundled with Photino | MIT; copyright and license notices are retained in [json.hpp](native/photino/json.hpp). |
| Bouncy Castle 2.6.2 | MIT; [included license](src/Headroom/BouncyCastle-LICENSE.txt). |

Additional build dependencies, including Photino.NET, Microsoft WebView2, Windows Implementation Library, and .NET, are restored from their packages and remain subject to their respective license terms. Package versions are pinned in [Headroom.csproj](src/Headroom/Headroom.csproj).
