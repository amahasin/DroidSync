export type PickerKind = 'displays' | 'cameras'

/** Option ids that get a "pick from the device" helper, and what they list. */
export const PICKER_FOR: Record<string, PickerKind> = {
  displayId: 'displays',
  cameraId: 'cameras',
  cameraSize: 'cameras'
}
