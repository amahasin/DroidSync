/**
 * Every scrcpy mirroring option the app exposes, as data.
 *
 * Deliberately left out, because the app owns them or they do not fit a mirror session:
 * --serial / --select-usb / --select-tcpip (the device card chooses the device), --tcpip and --otg
 * (their own flows), --list-* / --help / --version (information only), --kill-adb-on-close (would
 * stop the adb server this app tracks devices with), --pause-on-exit and --no-terminal-title
 * (there is no terminal), --v4l2-sink (Linux only).
 */
import type {
  ArgsOption,
  BoolOption,
  EnumOption,
  IntOption,
  OptionalOption,
  OptionDef,
  OptionGroup,
  PathOption,
  Pattern,
  StringOption
} from './optionTypes'

type Common<T> = Omit<T, 'kind' | 'flags'> & { flags: string | string[] }

const flagList = (flags: string | string[]): string[] => (Array.isArray(flags) ? flags : [flags])

const bool = (o: Common<BoolOption>): BoolOption => ({
  ...o,
  kind: 'bool',
  flags: flagList(o.flags)
})
const int = (o: Common<IntOption>): IntOption => ({ ...o, kind: 'int', flags: flagList(o.flags) })
const str = (o: Common<StringOption>): StringOption => ({
  ...o,
  kind: 'string',
  flags: flagList(o.flags)
})
const optional = (o: Common<OptionalOption>): OptionalOption => ({
  ...o,
  kind: 'optional',
  flags: flagList(o.flags)
})
const path = (o: Common<PathOption>): PathOption => ({
  ...o,
  kind: 'path',
  flags: flagList(o.flags)
})
const args = (o: Common<ArgsOption>): ArgsOption => ({
  ...o,
  kind: 'args',
  flags: flagList(o.flags)
})
const choice = (
  o: Omit<EnumOption, 'kind' | 'flags' | 'choices'> & {
    flags: string | string[]
    choices: Array<string | [string, string]>
  }
): EnumOption => ({
  ...o,
  kind: 'enum',
  flags: flagList(o.flags),
  choices: o.choices.map((c) =>
    typeof c === 'string' ? { value: c, label: c } : { value: c[0], label: c[1] }
  )
})

const ORIENTATIONS: Array<[string, string]> = [
  ['0', 'Normal'],
  ['90', 'Rotate 90°'],
  ['180', 'Rotate 180°'],
  ['270', 'Rotate 270°'],
  ['flip0', 'Flip'],
  ['flip90', 'Flip, rotate 90°'],
  ['flip180', 'Flip, rotate 180°'],
  ['flip270', 'Flip, rotate 270°']
]
const RECORD_ORIENTATIONS: Array<[string, string]> = ORIENTATIONS.slice(0, 4)

const BIT_RATE: Pattern = {
  regex: '^\\d+[KkMm]?$',
  message: 'Use a number with an optional K or M, like 8M.'
}
const CODEC_OPTIONS: Pattern = {
  regex:
    '^[A-Za-z0-9_.-]+(:(int|long|float|string))?=[^,]*(,[A-Za-z0-9_.-]+(:(int|long|float|string))?=[^,]*)*$',
  message: 'Use key=value pairs separated by commas, like profile=1,level=2.'
}
const SIZE: Pattern = { regex: '^\\d+x\\d+$', message: 'Use WIDTHxHEIGHT, like 1920x1080.' }
const MOUSE_BIND: Pattern = {
  regex: '^[bhsn+-]{4}(:[bhsn+-]{4})?$',
  message: 'Use four characters from b, h, s, n, + or -, optionally followed by : and four more.'
}

const g = (group: OptionGroup): { group: OptionGroup } => ({ group })

export const OPTIONS: OptionDef[] = [
  // ── Video ───────────────────────────────────────────────────────────────
  int({
    id: 'maxSize',
    ...g('video'),
    label: 'Max size',
    description: 'Limit the width and height of the mirrored video, in pixels. 0 means no limit.',
    flags: '--max-size',
    min: 0,
    max: 8192,
    default: 0,
    unit: 'px'
  }),
  str({
    id: 'videoBitRate',
    ...g('video'),
    label: 'Bit rate',
    description: 'Video bit rate, for example 8M or 2000K. scrcpy default is 8M.',
    flags: ['--video-bit-rate', '--bit-rate'],
    placeholder: '8M',
    maxLength: 12,
    pattern: BIT_RATE
  }),
  int({
    id: 'maxFps',
    ...g('video'),
    label: 'Max frame rate',
    description: 'Limit the capture frame rate. 0 means no limit.',
    flags: '--max-fps',
    min: 0,
    max: 240,
    default: 0,
    unit: 'fps'
  }),
  choice({
    id: 'videoCodec',
    ...g('video'),
    label: 'Video codec',
    description:
      'H.264 is the most compatible. H.265 and AV1 need device and GPU support; VP8 and VP9 only exist in the newest scrcpy.',
    flags: '--video-codec',
    choices: [
      ['h264', 'H.264'],
      ['h265', 'H.265'],
      ['av1', 'AV1'],
      ['vp8', 'VP8'],
      ['vp9', 'VP9']
    ]
  }),
  str({
    id: 'videoEncoder',
    ...g('video'),
    label: 'Video encoder',
    description: 'Use a specific MediaCodec encoder on the device by name.',
    flags: '--video-encoder',
    placeholder: 'OMX.qcom.video.encoder.avc',
    maxLength: 100
  }),
  str({
    id: 'videoCodecOptions',
    ...g('video'),
    label: 'Encoder options',
    description: 'Extra MediaCodec options as key=value pairs, for example profile=1,level=2.',
    flags: '--video-codec-options',
    placeholder: 'key=value,key2:int=2',
    maxLength: 200,
    pattern: CODEC_OPTIONS
  }),
  choice({
    id: 'videoSource',
    ...g('video'),
    label: 'Video source',
    description: 'Mirror the screen or a camera. Camera needs Android 12 or later.',
    flags: '--video-source',
    choices: [
      ['display', 'Screen'],
      ['camera', 'Camera']
    ]
  }),
  int({
    id: 'videoBuffer',
    ...g('video'),
    label: 'Video buffer',
    description:
      'Add a delay before showing frames to smooth out jitter. Higher is smoother but adds latency.',
    flags: '--video-buffer',
    min: 0,
    max: 5000,
    default: 0,
    unit: 'ms'
  }),
  int({
    id: 'displayId',
    ...g('video'),
    label: 'Display ID',
    description: 'Which device display to mirror. 0 is the main screen.',
    flags: '--display-id',
    min: 0,
    max: 1000000,
    default: 0
  }),
  choice({
    id: 'orientation',
    ...g('video'),
    label: 'Orientation',
    description: 'Rotate or flip the mirrored video, in the window and in recordings.',
    flags: '--orientation',
    choices: ORIENTATIONS
  }),
  choice({
    id: 'displayOrientation',
    ...g('video'),
    label: 'Display orientation',
    description: 'Rotate or flip only what is shown in the window.',
    flags: '--display-orientation',
    choices: ORIENTATIONS
  }),
  choice({
    id: 'recordOrientation',
    ...g('video'),
    label: 'Recording orientation',
    description: 'Rotate only what is written to the recording.',
    flags: '--record-orientation',
    choices: RECORD_ORIENTATIONS
  }),
  str({
    id: 'captureOrientation',
    ...g('video'),
    label: 'Capture orientation',
    description: 'Orientation of the captured video. Put @ in front, like @90, to lock it.',
    flags: '--capture-orientation',
    placeholder: '@0',
    maxLength: 12,
    pattern: {
      regex: '^@?(0|90|180|270|flip0|flip90|flip180|flip270)$',
      message: 'Use 0, 90, 180, 270 or a flip variant, optionally starting with @.'
    }
  }),
  str({
    id: 'angle',
    ...g('video'),
    label: 'Rotate by angle',
    description: 'Rotate the video by any clockwise angle in degrees.',
    flags: '--angle',
    placeholder: '15',
    maxLength: 8,
    pattern: { regex: '^-?\\d+(\\.\\d+)?$', message: 'Enter a number of degrees.' }
  }),
  str({
    id: 'crop',
    ...g('video'),
    label: 'Crop',
    description: 'Crop the device screen before sending: width:height:x:y.',
    flags: '--crop',
    placeholder: '1224:1440:0:0',
    maxLength: 30,
    pattern: {
      regex: '^\\d+:\\d+:\\d+:\\d+$',
      message: 'Use width:height:x:y, like 1224:1440:0:0.'
    }
  }),
  choice({
    id: 'hwdec',
    ...g('video'),
    label: 'Hardware decoding',
    description: 'How this computer decodes the video. Leave on default unless you see glitches.',
    flags: '--hwdec',
    choices: [
      ['auto', 'Automatic'],
      ['disabled', 'Disabled'],
      ['d3d11va', 'Direct3D 11']
    ]
  }),
  choice({
    id: 'renderDriver',
    ...g('video'),
    label: 'Render driver',
    description: 'Graphics backend used to draw the window. A hint, not a guarantee.',
    flags: '--render-driver',
    choices: [
      ['direct3d', 'Direct3D'],
      ['opengl', 'OpenGL'],
      ['opengles2', 'OpenGL ES 2'],
      ['opengles', 'OpenGL ES'],
      ['software', 'Software']
    ]
  }),
  choice({
    id: 'renderFit',
    ...g('video'),
    label: 'Render fit',
    description: 'How the video fills the window: letterbox, stretched or unscaled.',
    flags: '--render-fit',
    choices: ['letterbox', 'stretched', 'unscaled']
  }),
  bool({
    id: 'noMipmaps',
    ...g('video'),
    label: 'Disable mipmaps',
    description: 'Skip mipmap generation when scaling down. Sharper, slightly more GPU work.',
    flags: '--no-mipmaps'
  }),
  choice({
    id: 'minSizeAlignment',
    ...g('video'),
    label: 'Size alignment',
    description: 'Round the video size to a multiple of this value. Some encoders need 8 or 16.',
    flags: '--min-size-alignment',
    choices: ['1', '2', '4', '8', '16']
  }),
  bool({
    id: 'ignoreVideoEncoderConstraints',
    ...g('video'),
    label: 'Ignore encoder limits',
    description: 'Do not apply the size limits the device encoder reports.',
    flags: '--ignore-video-encoder-constraints'
  }),
  str({
    id: 'backgroundColor',
    ...g('video'),
    label: 'Background color',
    description: 'Color of the bars around the video, like #222 or #202020.',
    flags: '--background-color',
    placeholder: '#222',
    maxLength: 7,
    pattern: { regex: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$', message: 'Use #RGB or #RRGGBB.' }
  }),
  bool({
    id: 'noDownsizeOnError',
    ...g('video'),
    label: 'No retry at lower size',
    description: 'Do not retry at a smaller size when the device encoder fails.',
    flags: '--no-downsize-on-error'
  }),
  bool({
    id: 'noVideo',
    ...g('video'),
    label: 'Disable video',
    description: 'Do not forward video. Useful for audio-only mirroring.',
    flags: '--no-video'
  }),
  bool({
    id: 'noVideoPlayback',
    ...g('video'),
    label: 'No video playback',
    description: 'Receive video but do not show it, for example when only recording.',
    flags: '--no-video-playback'
  }),

  // ── Audio ───────────────────────────────────────────────────────────────
  bool({
    id: 'noAudio',
    ...g('audio'),
    label: 'Disable audio',
    description: 'Do not forward the device audio to this computer.',
    flags: '--no-audio'
  }),
  bool({
    id: 'noAudioPlayback',
    ...g('audio'),
    label: 'No audio playback',
    description: 'Receive audio but do not play it, for example when only recording.',
    flags: '--no-audio-playback'
  }),
  bool({
    id: 'requireAudio',
    ...g('audio'),
    label: 'Require audio',
    description: 'Stop with an error if audio capture fails, instead of mirroring without sound.',
    flags: '--require-audio'
  }),
  choice({
    id: 'audioSource',
    ...g('audio'),
    label: 'Audio source',
    description: 'What to capture: device output (default), what apps play, or a microphone.',
    flags: '--audio-source',
    choices: [
      ['output', 'Device output'],
      ['playback', 'App playback'],
      ['mic', 'Microphone'],
      ['mic-unprocessed', 'Microphone (unprocessed)'],
      ['mic-camcorder', 'Microphone (camcorder)'],
      ['mic-voice-recognition', 'Microphone (voice recognition)'],
      ['mic-voice-communication', 'Microphone (voice communication)'],
      ['voice-call', 'Voice call'],
      ['voice-call-uplink', 'Voice call (uplink)'],
      ['voice-call-downlink', 'Voice call (downlink)'],
      ['voice-performance', 'Voice performance']
    ]
  }),
  bool({
    id: 'audioDup',
    ...g('audio'),
    label: 'Keep playing on device',
    description:
      'Capture app audio and keep it playing on the device too. Needs the App playback source.',
    flags: '--audio-dup'
  }),
  choice({
    id: 'audioCodec',
    ...g('audio'),
    label: 'Audio codec',
    description: 'Opus is the default. Raw is uncompressed.',
    flags: '--audio-codec',
    choices: [
      ['opus', 'Opus'],
      ['aac', 'AAC'],
      ['flac', 'FLAC'],
      ['raw', 'Raw']
    ]
  }),
  str({
    id: 'audioBitRate',
    ...g('audio'),
    label: 'Audio bit rate',
    description: 'Audio bit rate, for example 128K. scrcpy default is 128K.',
    flags: '--audio-bit-rate',
    placeholder: '128K',
    maxLength: 12,
    pattern: BIT_RATE
  }),
  int({
    id: 'audioBuffer',
    ...g('audio'),
    label: 'Audio buffer',
    description:
      'Audio delay before playing. Lower is less latency but may crackle. scrcpy default is 50.',
    flags: '--audio-buffer',
    min: 0,
    max: 5000,
    unit: 'ms'
  }),
  int({
    id: 'audioOutputBuffer',
    ...g('audio'),
    label: 'Audio output buffer',
    description: 'Size of the audio output buffer on this computer. scrcpy default is 5.',
    flags: '--audio-output-buffer',
    min: 0,
    max: 5000,
    unit: 'ms'
  }),
  str({
    id: 'audioEncoder',
    ...g('audio'),
    label: 'Audio encoder',
    description: 'Use a specific MediaCodec audio encoder on the device by name.',
    flags: '--audio-encoder',
    maxLength: 100
  }),
  str({
    id: 'audioCodecOptions',
    ...g('audio'),
    label: 'Audio encoder options',
    description: 'Extra MediaCodec options as key=value pairs.',
    flags: '--audio-codec-options',
    placeholder: 'key=value',
    maxLength: 200,
    pattern: CODEC_OPTIONS
  }),

  // ── Camera ──────────────────────────────────────────────────────────────
  str({
    id: 'cameraId',
    ...g('camera'),
    label: 'Camera ID',
    description: 'Camera to mirror. Needs Video source set to Camera.',
    flags: '--camera-id',
    placeholder: '0',
    maxLength: 20,
    pattern: {
      regex: '^[A-Za-z0-9_.-]+$',
      message: 'Use the camera id shown by scrcpy --list-cameras.'
    }
  }),
  choice({
    id: 'cameraFacing',
    ...g('camera'),
    label: 'Camera facing',
    description: 'Pick a camera by direction instead of by id.',
    flags: '--camera-facing',
    choices: ['front', 'back', 'external']
  }),
  str({
    id: 'cameraSize',
    ...g('camera'),
    label: 'Camera size',
    description: 'Capture size, like 1920x1080.',
    flags: '--camera-size',
    placeholder: '1920x1080',
    maxLength: 12,
    pattern: SIZE
  }),
  str({
    id: 'cameraAr',
    ...g('camera'),
    label: 'Camera aspect ratio',
    description: 'Aspect ratio: sensor, a ratio like 4:3, or a decimal like 1.6.',
    flags: '--camera-ar',
    placeholder: '4:3',
    maxLength: 12,
    pattern: { regex: '^(sensor|\\d+:\\d+|\\d+(\\.\\d+)?)$', message: 'Use sensor, 4:3 or 1.6.' }
  }),
  int({
    id: 'cameraFps',
    ...g('camera'),
    label: 'Camera frame rate',
    description: 'Camera capture frame rate. scrcpy default is 30.',
    flags: '--camera-fps',
    min: 1,
    max: 240,
    unit: 'fps'
  }),
  bool({
    id: 'cameraHighSpeed',
    ...g('camera'),
    label: 'High-speed mode',
    description: 'Camera high-speed capture. Only some sizes and rates are allowed.',
    flags: '--camera-high-speed'
  }),
  bool({
    id: 'cameraTorch',
    ...g('camera'),
    label: 'Torch on',
    description: 'Turn the camera torch on when mirroring starts.',
    flags: '--camera-torch'
  }),
  str({
    id: 'cameraZoom',
    ...g('camera'),
    label: 'Camera zoom',
    description: 'Initial zoom factor.',
    flags: '--camera-zoom',
    placeholder: '1.0',
    maxLength: 8,
    pattern: { regex: '^\\d+(\\.\\d+)?$', message: 'Enter a number, like 2 or 1.5.' }
  }),

  // ── Input & control ─────────────────────────────────────────────────────
  bool({
    id: 'noControl',
    ...g('control'),
    label: 'View only',
    description: 'Mirror read-only: mouse and keyboard input are not sent to the device.',
    flags: '--no-control'
  }),
  choice({
    id: 'keyboard',
    ...g('control'),
    label: 'Keyboard mode',
    description:
      'How keys reach the device. SDK is the default; UHID and AOA act like a real keyboard.',
    flags: '--keyboard',
    choices: [
      ['disabled', 'Disabled'],
      ['sdk', 'SDK'],
      ['uhid', 'UHID (simulated)'],
      ['aoa', 'AOA (USB only)']
    ]
  }),
  choice({
    id: 'mouse',
    ...g('control'),
    label: 'Mouse mode',
    description: 'How the mouse reaches the device. SDK is the default.',
    flags: '--mouse',
    choices: [
      ['disabled', 'Disabled'],
      ['sdk', 'SDK'],
      ['uhid', 'UHID (simulated)'],
      ['aoa', 'AOA (USB only)']
    ]
  }),
  str({
    id: 'mouseBind',
    ...g('control'),
    label: 'Mouse buttons',
    description: 'What the secondary buttons do: four characters for right, middle, 4th and 5th.',
    flags: '--mouse-bind',
    placeholder: 'bhsn:++++',
    maxLength: 9,
    pattern: MOUSE_BIND
  }),
  choice({
    id: 'gamepad',
    ...g('control'),
    label: 'Gamepad mode',
    description: 'Forward game controllers connected to this computer.',
    flags: '--gamepad',
    choices: [
      ['disabled', 'Disabled'],
      ['uhid', 'UHID (simulated)'],
      ['aoa', 'AOA (USB only)']
    ]
  }),
  bool({
    id: 'noKeyRepeat',
    ...g('control'),
    label: 'No key repeat',
    description: 'Ignore repeated key events while a key is held down.',
    flags: '--no-key-repeat'
  }),
  bool({
    id: 'noMouseHover',
    ...g('control'),
    label: 'No mouse hover',
    description: 'Ignore mouse movement when no button is pressed.',
    flags: '--no-mouse-hover'
  }),
  bool({
    id: 'preferText',
    ...g('control'),
    label: 'Prefer text input',
    description: 'Send letters and space as text instead of key events. Helps some input methods.',
    flags: '--prefer-text'
  }),
  bool({
    id: 'rawKeyEvents',
    ...g('control'),
    label: 'Raw key events',
    description: 'Send every key as a key event and never as text.',
    flags: '--raw-key-events'
  }),
  bool({
    id: 'legacyPaste',
    ...g('control'),
    label: 'Legacy paste',
    description: 'Paste by typing Ctrl+V on the device instead of setting its clipboard.',
    flags: '--legacy-paste'
  }),
  bool({
    id: 'noClipboardAutosync',
    ...g('control'),
    label: 'No clipboard sync',
    description: 'Do not copy the clipboard between this computer and the device automatically.',
    flags: '--no-clipboard-autosync'
  }),
  str({
    id: 'shortcutMod',
    ...g('control'),
    label: 'Shortcut key',
    description:
      'Key that triggers scrcpy shortcuts, like lalt, lsuper or lctrl+lalt. Comma separates alternatives.',
    flags: '--shortcut-mod',
    placeholder: 'lalt,lsuper',
    maxLength: 60,
    pattern: {
      regex:
        '^(lctrl|rctrl|lalt|ralt|lsuper|rsuper)(\\+(lctrl|rctrl|lalt|ralt|lsuper|rsuper))*(,(lctrl|rctrl|lalt|ralt|lsuper|rsuper)(\\+(lctrl|rctrl|lalt|ralt|lsuper|rsuper))*)*$',
      message:
        'Use lctrl, rctrl, lalt, ralt, lsuper or rsuper, joined by + and separated by commas.'
    }
  }),

  // ── Recording ───────────────────────────────────────────────────────────
  path({
    id: 'record',
    ...g('recording'),
    label: 'Record to file',
    description:
      'Save the mirrored video and audio. Use {device}, {date} and {time} in the name so each device and run gets its own file.',
    flags: '--record',
    placeholder: 'C:\\Videos\\{device}-{date}-{time}.mp4',
    extensions: ['mp4', 'mkv', 'm4a', 'mka', 'opus', 'aac', 'flac', 'wav']
  }),
  choice({
    id: 'recordFormat',
    ...g('recording'),
    label: 'Recording format',
    description: 'Container format. Normally chosen from the file extension.',
    flags: '--record-format',
    choices: ['mp4', 'mkv', 'm4a', 'mka', 'opus', 'aac', 'flac', 'wav']
  }),

  // ── Window ──────────────────────────────────────────────────────────────
  bool({
    id: 'fullscreen',
    ...g('window'),
    label: 'Start fullscreen',
    description: 'Open the mirror window in fullscreen.',
    flags: '--fullscreen'
  }),
  bool({
    id: 'alwaysOnTop',
    ...g('window'),
    label: 'Always on top',
    description: 'Keep the mirror window above other windows.',
    flags: '--always-on-top'
  }),
  bool({
    id: 'windowBorderless',
    ...g('window'),
    label: 'Borderless window',
    description: 'Remove the window title bar and border.',
    flags: '--window-borderless'
  }),
  str({
    id: 'windowTitle',
    ...g('window'),
    label: 'Window title',
    description: 'Title of the mirror window. Defaults to the device name and serial.',
    flags: '--window-title',
    placeholder: 'Device name',
    maxLength: 100
  }),
  int({
    id: 'windowX',
    ...g('window'),
    label: 'Window X',
    description: 'Initial horizontal position, in pixels from the left of the screen.',
    flags: '--window-x',
    min: -32768,
    max: 32767,
    unit: 'px'
  }),
  int({
    id: 'windowY',
    ...g('window'),
    label: 'Window Y',
    description: 'Initial vertical position, in pixels from the top of the screen.',
    flags: '--window-y',
    min: -32768,
    max: 32767,
    unit: 'px'
  }),
  int({
    id: 'windowWidth',
    ...g('window'),
    label: 'Window width',
    description: 'Initial window width. 0 picks a size automatically.',
    flags: '--window-width',
    min: 0,
    max: 32767,
    default: 0,
    unit: 'px'
  }),
  int({
    id: 'windowHeight',
    ...g('window'),
    label: 'Window height',
    description: 'Initial window height. 0 picks a size automatically.',
    flags: '--window-height',
    min: 0,
    max: 32767,
    default: 0,
    unit: 'px'
  }),
  bool({
    id: 'noWindowAspectRatioLock',
    ...g('window'),
    label: 'Free resize',
    description: 'Let the window be resized to any shape instead of keeping the aspect ratio.',
    flags: '--no-window-aspect-ratio-lock'
  }),
  bool({
    id: 'noWindow',
    ...g('window'),
    label: 'No window',
    description: 'Do not open a window. Implies no video playback.',
    flags: '--no-window'
  }),
  bool({
    id: 'noPlayback',
    ...g('window'),
    label: 'No playback',
    description: 'Do not play video or audio on this computer.',
    flags: '--no-playback'
  }),
  bool({
    id: 'flexDisplay',
    ...g('window'),
    label: 'Resize device to window',
    description: 'Resize the virtual display to match the window. Used with a virtual display.',
    flags: '--flex-display'
  }),

  // ── Device ──────────────────────────────────────────────────────────────
  bool({
    id: 'stayAwake',
    ...g('device'),
    label: 'Keep device awake',
    description: 'Prevent the device from sleeping while it is plugged in.',
    flags: '--stay-awake'
  }),
  bool({
    id: 'turnScreenOff',
    ...g('device'),
    label: 'Turn device screen off',
    description: 'Switch the device screen off while mirroring continues.',
    flags: '--turn-screen-off'
  }),
  int({
    id: 'screenOffTimeout',
    ...g('device'),
    label: 'Screen-off timeout',
    description: 'Temporarily change how long the device waits before turning its screen off.',
    flags: '--screen-off-timeout',
    min: 1,
    max: 86400,
    unit: 's'
  }),
  bool({
    id: 'keepActive',
    ...g('device'),
    label: 'Keep screen active',
    description: 'Keep the screen on by simulating activity.',
    flags: '--keep-active'
  }),
  bool({
    id: 'showTouches',
    ...g('device'),
    label: 'Show touches',
    description: 'Show a dot where the screen is touched. Useful for demos.',
    flags: '--show-touches'
  }),
  bool({
    id: 'powerOffOnClose',
    ...g('device'),
    label: 'Screen off on close',
    description: 'Turn the device screen off when mirroring stops.',
    flags: '--power-off-on-close'
  }),
  bool({
    id: 'noPowerOn',
    ...g('device'),
    label: 'Do not wake device',
    description: 'Do not power the device on when mirroring starts.',
    flags: '--no-power-on'
  }),
  bool({
    id: 'disableScreensaver',
    ...g('device'),
    label: 'Disable screensaver',
    description: 'Stop this computer’s screensaver while mirroring.',
    flags: '--disable-screensaver'
  }),
  int({
    id: 'timeLimit',
    ...g('device'),
    label: 'Time limit',
    description: 'Stop mirroring after this many seconds.',
    flags: '--time-limit',
    min: 1,
    max: 604800,
    unit: 's'
  }),
  bool({
    id: 'noCleanup',
    ...g('device'),
    label: 'Skip cleanup',
    description: 'Do not remove the server or restore device settings on exit.',
    flags: '--no-cleanup'
  }),
  str({
    id: 'pushTarget',
    ...g('device'),
    label: 'Drop-file folder',
    description: 'Device folder that files dropped on the window are copied to.',
    flags: '--push-target',
    placeholder: '/sdcard/Download/',
    maxLength: 200
  }),

  // ── Virtual display ─────────────────────────────────────────────────────
  optional({
    id: 'newDisplay',
    ...g('display'),
    label: 'Virtual display',
    description:
      'Mirror a new virtual display instead of the screen. Optionally set a size and density.',
    flags: '--new-display',
    placeholder: '1920x1080/420',
    maxLength: 20,
    pattern: {
      regex: '^(\\d+x\\d+)?(/\\d+)?$',
      message: 'Use WIDTHxHEIGHT, /DPI, or both, like 1920x1080/420.'
    }
  }),
  str({
    id: 'startApp',
    ...g('display'),
    label: 'Start app',
    description:
      'Launch an app by package name. Start with ? to search by name, or + to force-stop it first.',
    flags: '--start-app',
    placeholder: 'com.android.chrome',
    maxLength: 100
  }),
  choice({
    id: 'displayImePolicy',
    ...g('display'),
    label: 'Keyboard on virtual display',
    description: 'Where the on-screen keyboard appears for a virtual display.',
    flags: '--display-ime-policy',
    choices: [
      ['local', 'On the virtual display'],
      ['fallback', 'Fallback'],
      ['hide', 'Hidden']
    ]
  }),
  bool({
    id: 'noVdDestroyContent',
    ...g('display'),
    label: 'Keep content on close',
    description: 'Move apps to the main display when the virtual display closes.',
    flags: '--no-vd-destroy-content'
  }),
  bool({
    id: 'noVdSystemDecorations',
    ...g('display'),
    label: 'No system decorations',
    description: 'Hide status and navigation bars on the virtual display.',
    flags: '--no-vd-system-decorations'
  }),

  // ── Advanced ────────────────────────────────────────────────────────────
  str({
    id: 'port',
    ...g('advanced'),
    label: 'Local port range',
    description: 'Ports on this computer used for the connection, like 27183:27199.',
    flags: '--port',
    placeholder: '27183:27199',
    maxLength: 11,
    pattern: { regex: '^\\d{1,5}(:\\d{1,5})?$', message: 'Use a port or a range like 27183:27199.' }
  }),
  bool({
    id: 'forceAdbForward',
    ...g('advanced'),
    label: 'Force adb forward',
    description: 'Use adb forward instead of adb reverse for the connection.',
    flags: '--force-adb-forward'
  }),
  str({
    id: 'tunnelHost',
    ...g('advanced'),
    label: 'Tunnel host',
    description: 'IP address of the adb tunnel, when adb runs on another machine.',
    flags: '--tunnel-host',
    placeholder: '127.0.0.1',
    maxLength: 45,
    pattern: { regex: '^[0-9A-Fa-f:.]+$', message: 'Enter an IP address.' }
  }),
  int({
    id: 'tunnelPort',
    ...g('advanced'),
    label: 'Tunnel port',
    description: 'Port of the adb tunnel. 0 picks one automatically.',
    flags: '--tunnel-port',
    min: 0,
    max: 65535,
    default: 0
  }),
  bool({
    id: 'printFps',
    ...g('advanced'),
    label: 'Print frame rate',
    description: 'Write the frame rate to the log.',
    flags: '--print-fps'
  }),
  choice({
    id: 'verbosity',
    ...g('advanced'),
    label: 'Log detail',
    description: 'How much scrcpy writes to the log.',
    flags: '--verbosity',
    choices: ['verbose', 'debug', 'info', 'warn', 'error']
  }),
  args({
    id: 'extraArgs',
    ...g('advanced'),
    label: 'Extra arguments',
    description:
      'Anything else, added to the command as written. Quote values with spaces. Device selection flags are managed by the app and rejected.',
    flags: [],
    placeholder: '--some-new-flag --other=value',
    maxLength: 500
  })
]
