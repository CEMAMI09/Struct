export const FACTORY_MARKER:string
export const MAX_IMAGE: number
export function canonical(value: any): Buffer
export function fingerprint(pem: string): string
export function publicKey(pem: string): any
export function verifyManifest(
  value: any,
  signature: string,
  pem: string,
): Buffer
export function validateImageHeader(header: Buffer, value: any): void
export function configuration(value: any): Record<string, any>
export function capabilities(value: any): Record<string, any>
export function digest(value: any): string
export function managementKey(root: string, wire: number): Buffer
export function requestMac(
  key: Buffer,
  wire: number,
  id: string,
  nonce: string,
  hash: string,
): string
export function authenticate(
  root: string,
  wire: number,
  id: string,
  nonce: string,
  payload: string,
  mac: string,
): { body: any; hash: string }
export function uuid(value: any): boolean
