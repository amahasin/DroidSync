import { describe, expect, it } from 'vitest'
import {
  PACKAGE_NAME,
  parseCameras,
  parseDisplays,
  parseInstallOutput,
  parseLauncherPackages,
  parseListApps,
  parsePackageList
} from './parse'

describe('parseInstallOutput', () => {
  it('recognises success', () => {
    expect(parseInstallOutput('Performing Streamed Install\nSuccess\n')).toEqual({
      ok: true,
      message: 'Installed.'
    })
  })

  it('turns known failure codes into plain advice', () => {
    const out = parseInstallOutput('Failure [INSTALL_FAILED_VERSION_DOWNGRADE]')
    expect(out.ok).toBe(false)
    expect(out.message).toMatch(/newer version/)
    expect(
      parseInstallOutput('Failure [INSTALL_FAILED_USER_RESTRICTED: Install canceled by user]')
        .message
    ).toMatch(/Install via USB/)
  })

  it('keeps the code for failures it does not know', () => {
    expect(parseInstallOutput('Failure [INSTALL_FAILED_SOMETHING_NEW: because]').message).toBe(
      'The device refused the install (INSTALL_FAILED_SOMETHING_NEW: because).'
    )
  })

  it('falls back to the first line that names an error, or a generic message', () => {
    expect(parseInstallOutput('Error: Unknown option\nException occurred').message).toBe(
      'Install failed: Unknown option'
    )
    expect(parseInstallOutput('Something odd happened\nmore').message).toBe(
      'Install failed: Something odd happened'
    )
    expect(parseInstallOutput('  ')).toEqual({ ok: false, message: 'Install failed.' })
  })

  it('recognises a file that is not an APK from the real Android 10 output', () => {
    const output = [
      'Error: Failed to parse APK file: /data/local/tmp/droidsync-ab12.apk',
      '',
      'Exception occurred while executing:',
      'java.lang.IllegalArgumentException: Error: Failed to parse APK file: /data/local/tmp/x.apk',
      '\tat com.android.server.pm.PackageManagerShellCommand.setParamsSize(PackageManagerShellCommand.java:471)',
      '\t... 10 more'
    ].join('\n')
    expect(parseInstallOutput(output)).toEqual({
      ok: false,
      message: 'The file is not a valid APK.'
    })
  })

  it('removes the temporary path from unknown errors', () => {
    expect(
      parseInstallOutput('Error: Could not read /data/local/tmp/droidsync-ab12.apk.').message
    ).toBe('Install failed: Could not read')
  })

  it('does not call a message containing "Success" in the middle a success', () => {
    expect(parseInstallOutput('Failure [INSTALL_FAILED_INVALID_APK] (not Success)').ok).toBe(false)
  })
})

describe('parseListApps', () => {
  const sample = [
    'scrcpy 3.1 <https://github.com/Genymobile/scrcpy>',
    '[server] INFO: List of apps:',
    ' * Calculator                     com.google.android.calculator',
    ' - Mi Home                        com.xiaomi.smarthome',
    ' - Chrome Beta                    com.chrome.beta',
    ' - Chrome Beta                    com.chrome.beta',
    'INFO: something else'
  ].join('\r\n')

  it('reads label, package and whether it is a system app', () => {
    expect(parseListApps(sample)).toEqual([
      { packageName: 'com.google.android.calculator', label: 'Calculator', system: true },
      { packageName: 'com.xiaomi.smarthome', label: 'Mi Home', system: false },
      { packageName: 'com.chrome.beta', label: 'Chrome Beta', system: false }
    ])
  })

  it('returns nothing for output without apps', () => {
    expect(parseListApps('scrcpy: unknown option -- list-apps')).toEqual([])
  })
})

describe('adb based app lists', () => {
  it('reads launcher packages from query-activities output', () => {
    const text = [
      '20 activities found:',
      '  Activity #0:',
      '    priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true',
      '    com.android.deskclock/.DeskClock',
      '  Activity #1:',
      '    com.google.android.youtube.tv/com.google.android.apps.youtube.tv.activity.ShellActivity',
      '    com.android.deskclock/.Other'
    ].join('\n')
    expect(parseLauncherPackages(text)).toEqual([
      'com.android.deskclock',
      'com.google.android.youtube.tv'
    ])
  })

  it('reads package lists and skips junk', () => {
    expect(parsePackageList('package:com.tailscale.ipn\r\npackage:bad name\r\nnoise\r\n')).toEqual([
      'com.tailscale.ipn'
    ])
  })
})

describe('PACKAGE_NAME', () => {
  it('accepts real package names', () => {
    for (const ok of ['com.android.chrome', 'com.a_b.c1', 'org.x.y.z']) {
      expect(PACKAGE_NAME.test(ok)).toBe(true)
    }
  })

  it('rejects anything that could be more than a name', () => {
    for (const bad of [
      '',
      'chrome',
      'com..x',
      'com.x ',
      'com.x;calc',
      'com.x\n',
      '1com.x',
      '$(calc).x'
    ]) {
      expect(PACKAGE_NAME.test(bad)).toBe(false)
    }
  })
})

describe('parseDisplays', () => {
  it('reads the TV output', () => {
    const text = [
      'scrcpy 2.6.1',
      '[server] INFO: List of displays:',
      '    --display-id=0    (1920x1080)',
      '    --display-id=3    (800x600)'
    ].join('\n')
    expect(parseDisplays(text)).toEqual([
      { id: 0, size: '1920x1080' },
      { id: 3, size: '800x600' }
    ])
  })

  it('copes with a display that has no size', () => {
    expect(parseDisplays('    --display-id=2')).toEqual([{ id: 2, size: null }])
  })
})

describe('parseCameras', () => {
  it('reads cameras and their details', () => {
    const text = [
      '[server] INFO: List of cameras:',
      '    --camera-id=0    (back, 4000x3000, fps=[15, 24, 30])',
      '    --camera-id=1    (front, 3264x2448, fps=[30])'
    ].join('\n')
    expect(parseCameras(text)).toEqual([
      { id: '0', facing: 'back', size: '4000x3000', fps: '15, 24, 30', sizes: [] },
      { id: '1', facing: 'front', size: '3264x2448', fps: '30', sizes: [] }
    ])
  })

  it('reads sizes under each camera, but not high speed ones', () => {
    const text = [
      '    --camera-id=0    (back, 4000x3000, fps=[30])',
      '        - 4000x3000',
      '        - 1920x1080',
      '      High speed capture sizes:',
      '        - 1280x720',
      '    --camera-id=1    (front, 1280x720, fps=[30])',
      '        - 1280x720'
    ].join('\n')
    const cameras = parseCameras(text)
    expect(cameras[0].sizes).toEqual(['4000x3000', '1920x1080'])
    expect(cameras[1].sizes).toEqual(['1280x720'])
  })

  it('returns an empty list for "(none)"', () => {
    expect(parseCameras('[server] INFO: List of cameras:\n    (none)')).toEqual([])
  })
})
