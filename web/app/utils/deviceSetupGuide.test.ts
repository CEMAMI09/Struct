import { describe, expect, it } from 'vitest'
import { shouldShowDeviceSetupGuide } from './deviceSetupGuide'

const ready = {
  hasError: false,
  devicesLoaded: true,
  deviceCount: 1,
  hasSelectedDevice: true,
  hasSchema: true,
  telemetrySettled: true,
  telemetryCount: 3,
}

describe('shouldShowDeviceSetupGuide', () => {
  it('stays hidden while devices or telemetry are still loading for a configured device', () => {
    expect(shouldShowDeviceSetupGuide({
      ...ready,
      devicesLoaded: false,
      deviceCount: 0,
      hasSelectedDevice: false,
      hasSchema: false,
      telemetrySettled: false,
      telemetryCount: 0,
    })).toBe(false)

    expect(shouldShowDeviceSetupGuide({
      ...ready,
      telemetrySettled: false,
      telemetryCount: 0,
    })).toBe(false)
  })

  it('stays hidden once a configured device has stored events', () => {
    expect(shouldShowDeviceSetupGuide(ready)).toBe(false)
  })

  it('shows when the workspace has no device, schema, or stored events', () => {
    expect(shouldShowDeviceSetupGuide({
      ...ready,
      deviceCount: 0,
      hasSelectedDevice: false,
      hasSchema: false,
      telemetryCount: 0,
    })).toBe(true)

    expect(shouldShowDeviceSetupGuide({
      ...ready,
      hasSchema: false,
      telemetrySettled: false,
      telemetryCount: 0,
    })).toBe(true)

    expect(shouldShowDeviceSetupGuide({
      ...ready,
      telemetryCount: 0,
    })).toBe(true)
  })

  it('does not treat a failed device load as an empty workspace', () => {
    expect(shouldShowDeviceSetupGuide({
      ...ready,
      hasError: true,
      devicesLoaded: false,
      deviceCount: 0,
      hasSelectedDevice: false,
      telemetryCount: 0,
    })).toBe(false)
  })
})
