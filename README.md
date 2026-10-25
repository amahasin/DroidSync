# DroidSync

A Windows 11 app for mirroring and controlling Android devices. It is a friendly front end for
[scrcpy](https://github.com/Genymobile/scrcpy): scrcpy does the mirroring, DroidSync adds the parts the
command line lacks.

## What it does

- Lists connected devices live, and starts or stops mirroring with one click, on several devices at once.
- Every scrcpy option is available from a searchable settings page, with named presets and a preset per device.
- Wi-Fi setup without a terminal: pairing with a code, connecting by address, nearby devices, switching a
  USB device to Wi-Fi, and automatic reconnecting.
- Screenshots (saved and copied to the clipboard), installing APKs and copying files by dropping them on a
  device, an app list, and a list of your recordings and screenshots.
- Tray icon, global shortcuts, start with Windows, and keyboard-and-mouse-only (OTG) mode.
- A diagnostics report for bug reports that hides device serials, IP addresses and your user name.

## Install

1. Download `DroidSync-<version>-setup.exe` from the [Releases](https://github.com/amahasin/DroidSync/releases) page.
2. Run it. It installs for your user only and needs no administrator rights.
3. The setup file is **not code signed yet**, so Windows SmartScreen may say it protected your PC. Choose
   **More info**, then **Run anyway**.

DroidSync needs scrcpy. If it is not on your PATH, the app offers to download the official release from
GitHub and checks it against the SHA-256 that GitHub publishes.

On the phone, turn on Developer options and USB debugging (or Wireless debugging for Wi-Fi).

## Build from source

```bash
npm install
npm run dev          # run with hot reload
npm run build:win    # typecheck, build and make the installer in dist/
```

Other commands: `npm test`, `npm run lint`, `npm run typecheck`. See [RELEASING.md](RELEASING.md) to publish a release.

## Licence

DroidSync is released under the [MIT licence](LICENSE).

## Credits

DroidSync is not affiliated with Genymobile. scrcpy is their project, released under the Apache License 2.0.
Android is a trademark of Google LLC.
