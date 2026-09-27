/** Whether the dashboard should show the first-device setup guide. */
export function shouldShowDeviceSetupGuide(state: {
  hasError: boolean
  devicesLoaded: boolean
  deviceCount: number
  hasSelectedDevice: boolean
  hasSchema: boolean
  telemetrySettled: boolean
  telemetryCount: number
}) {
  // Unloaded data looks like "no device". Keep the guide hidden until that is known.
  if (state.hasError || !state.devicesLoaded) return false
  if (!state.deviceCount || !state.hasSelectedDevice) return state.deviceCount === 0
  if (!state.hasSchema) return true
  if (!state.telemetrySettled) return false
  return state.telemetryCount === 0
}
