# Third-party notices

DovahHub Minipets is licensed under the GNU General Public License v3.0 or later (GPL-3.0-or-later; see `LICENSE`).
Source code: https://github.com/kezc7/DovahHub-Minipets

The plugin DLL is built with the following, which are compiled into it:

| Component | License | Text |
| --- | --- | --- |
| [CommonLibSSE-NG](https://github.com/alandtse/CommonLibSSE-NG) 7.5.4, commit c542446 | GPL-3.0-or-later WITH Modding Exception AND GPL-3.0 Linking Exception (with Corresponding Source) | `licenses/CommonLibSSE-NG-COPYING.txt`, `licenses/CommonLibSSE-NG-EXCEPTIONS.md` |
| CommonLibSSE (original code by Ryan-rsm-McKenzie), on which CommonLibSSE-NG is based | MIT | `licenses/CommonLibSSE-original-MIT.txt` |

The copy of CommonLibSSE-NG in `lib/commonlibsse-ng` matches upstream commit c542446 (7.5.4, 12 Sep 2026): its
`include` and `src` folders are the same as upstream's there. CommonLibSSE-NG has been GPL-3.0-or-later with these
exceptions since commit 12f8518 (25 Jul 2026). Before that it was MIT, and upstream keeps that MIT text in
`licenses/LICENSE-MIT.txt`. The three licence files above are upstream's own texts at c542446, unchanged.
| [spdlog](https://github.com/gabime/spdlog) 1.16.0 | MIT | `licenses/spdlog-LICENSE.txt` |
| [DirectXTK](https://github.com/microsoft/DirectXTK) | MIT | `licenses/DirectXTK-LICENSE.txt` |
| [DirectXMath](https://github.com/microsoft/DirectXMath) | MIT | `licenses/DirectXMath-LICENSE.txt` |
| [rapidcsv](https://github.com/d99kris/rapidcsv) 8.92 | BSD 3-Clause | `licenses/rapidcsv-LICENSE.txt` |

`src/PrismaUI_API.h` and the key handler in `keyhandler/` come from the
[Prisma UI example plugin](https://github.com/PrismaUI-SKSE/example-skse-plugin), which
provides them for modders to copy into their own projects.

The settings window uses the Dovah suite's theme (`view/theme/dovah-theme.css`, from DovahHub, GPL-3.0-or-later) with the
[Barlow Condensed](https://github.com/jpt/barlow) font (copyright The Barlow Project Authors), under the SIL Open Font License 1.1
(`view/theme/fonts/OFL-BarlowCondensed.txt`, shipped beside the font files).

Prisma UI itself, SKSE and Address Library are separate downloads and aren't included.
