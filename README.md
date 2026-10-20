# Build files

Personal desktop app build. Install from the latest release:

- `YouTube_<version>_x64_en-US.msi` — full installer.
- `YouTube-Update.zip` — updates an existing install (extract, run `Install update.cmd`).

Installed apps update themselves: an Update button appears in the title bar when a new release is out.

## Building

```powershell
.\build.ps1 -Version 1.2.3 -Repo owner/name -Publish
```

See the top of `build.ps1` for requirements. `pake-patches/` holds modified files from pake-cli 3.17.6 (MIT); `app/` holds the injected scripts.

Third-party tools bundled in the installer are listed in [NOTICE.md](NOTICE.md).
