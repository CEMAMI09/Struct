export const HEADER_BYTES: number
export const RECEIPT_BYTES: number
export function buildFrame(options: { payload: Buffer; wireDeviceId?: number; sequence?: number; slot?: number; confirmed?: boolean; batch?: boolean }): Buffer
export function decodeFrame(frame: Buffer): { slot: number; sequence: number; confirmed: boolean; batch: boolean; wireDeviceId: number; plaintext: Buffer }
export function receipt(sequence: number): Buffer
