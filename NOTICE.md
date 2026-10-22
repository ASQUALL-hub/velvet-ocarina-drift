# Third-party software

The installer bundles these unmodified programs in its `tools` folder:

| Program | License | Source |
|---|---|---|
| yt-dlp | Unlicense | https://github.com/yt-dlp/yt-dlp |
| FFmpeg (gyan.dev full build) | GPL-3.0 | https://ffmpeg.org/download.html · build: https://www.gyan.dev/ffmpeg/builds/ · source: https://github.com/FFmpeg/FFmpeg |
| Deno | MIT | https://github.com/denoland/deno |

It also bundles this browser extension, unmodified, in its `extensions` folder (installed apps update it from its official releases):

| Extension | License | Source |
|---|---|---|
| uBlock Origin Lite (Edge build) | GPL-3.0 | https://github.com/uBlockOrigin/uBOL-home |

The app itself is built with [Pake](https://github.com/tw93/Pake) (MIT) and [Tauri](https://tauri.app) (MIT / Apache-2.0).
