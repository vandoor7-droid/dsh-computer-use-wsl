# Third-party notices

This package **does not bundle** any third-party binaries. It drives programs
that are expected to be present in the Linux distribution at runtime, installed
by the user (the `bootstrap` tool calls the distribution's package manager).

| Component | Role | License (upstream) |
|---|---|---|
| [Xvfb](https://www.x.org/) (xorg-server) | virtual X server | MIT / X11 |
| [openbox](http://openbox.org/) | optional window manager | GPL-2.0-or-later |
| [x11vnc](https://github.com/LibVNC/x11vnc) | VNC server for a real X display | GPL-2.0-or-later |
| [noVNC](https://github.com/novnc/noVNC) | browser VNC client | MPL-2.0 |
| [websockify](https://github.com/novnc/websockify) | WebSocket-to-TCP bridge | LGPL-3.0 (upstream dual) |
| [xdotool](https://github.com/jordansissel/xdotool) | input synthesis | BSD-3-Clause |
| [xclip](https://github.com/astrand/xclip) | X selections | GPL-2.0-or-later |
| [ImageMagick](https://imagemagick.org/) (`import`, `identify`, `convert`) | screen capture / metrics | ImageMagick License (Apache-2.0 compatible) |

The MIT license of this package covers only the code in this repository.

`@deepseek-ai/dsh-mcp-client` and `@deepseek-ai/schemastery` are declared as
optional peer dependencies and are provided by the host DSH installation.
