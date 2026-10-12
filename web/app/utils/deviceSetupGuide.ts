/** Global progress is workspace scoped and independent of device/history selection. */
export function shouldShowDeviceSetupGuide(state:{loaded:boolean;firstPacketAt:string|null;dismissedAt:string|null;reopened?:boolean}) {
  return state.loaded && (!!state.reopened || (!state.firstPacketAt && !state.dismissedAt))
}
