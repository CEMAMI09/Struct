/// <reference types="node" />
export interface SecureFrameOptions {rootSecret:string|Buffer;wireDeviceId:number;sequence:number;slot?:number;confirmed?:boolean;batch?:boolean;payload:Buffer;maximum?:number}
export const HEADER_BYTES:9;export const TAG_BYTES:16;export const FRAME_OVERHEAD:25;export const RECEIPT_BYTES:21;
export const DEFAULT_MAX_FRAME_BYTES:1200;export const MAX_FRAME_BYTES:1400;
export const DEFAULT_INGEST_HOST:'ingest.usestruct.com';export const DEFAULT_UDP_PORT:8081;
export const GENERATION_MASK:192;export const UPLINK_GENERATION:128;export const RECEIPT_CONTROL:192;
export const SLOT_MASK:60;export const RECEIPT_FLAG:2;export const BATCH_FLAG:1;
export const HKDF_SALT:Buffer;
export const LABELS:Readonly<{uplinkKey:string;downlinkKey:string;uplinkPrefix:string;downlinkPrefix:string}>;
export function uint32(value:number,name:string):number;
export function wireId(value:number):number;
export function rootBytes(root:string|Buffer):Buffer;
export function maxFrameBytes(value?:number):number;
export function deriveKeys(root:string|Buffer,wireDeviceId:number):{uplinkKey:Buffer;downlinkKey:Buffer;uplinkPrefix:Buffer;downlinkPrefix:Buffer};
export function nonce(prefix:Buffer,sequence:number):Buffer;
export function controlByte(options?:{slot?:number;confirmed?:boolean;batch?:boolean}):number;
export function isSecureV2(frame:Buffer):boolean;
export function parseHeader(frame:Buffer,maximum?:number):{control:number;wireDeviceId:number;sequence:number;slot:number;confirmed:boolean;batch:boolean;aad:Buffer};
export function buildFrame(options:SecureFrameOptions):Buffer;
export function decryptFrame(frame:Buffer,rootSecret:string|Buffer,maximum?:number):ReturnType<typeof parseHeader>&{plaintext:Buffer};
export function buildReceipt(rootSecret:string|Buffer,wireDeviceId:number,sequence:number):Buffer;
export function verifyReceipt(receipt:Buffer,rootSecret:string|Buffer,wireDeviceId:number,sequence:number):boolean;
export function buildBatch(records:Buffer[],maximum?:number):Buffer;
export function splitBatch(records:Buffer[],maximum?:number):Buffer[];
export function splitRecords(plaintext:Buffer,options:{batch:boolean;recordBytes:number}):Buffer[];
