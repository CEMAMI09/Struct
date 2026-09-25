/// <reference types="node" />
export interface ClientOptions { host:string; port?:number; keyId:string; apiSecret:string; encryptionKey?:string }
export interface Delivery { confirmed?:boolean; maxRetries?:number; retryMs?:number; budgetMs?:number; eventId?:Buffer }
export interface Outcome { status:'sent'|'committed'|'unknown'; attempts:number; elapsedMs:number; duplicate?:boolean; packet_id:string }
export class StructClient {
 constructor(options:ClientOptions);
 readonly options:ClientOptions;
 send(schemaVersion:number,payload:Buffer,delivery?:Delivery):Promise<Outcome>;
}
export function buildFrame(options:Omit<ClientOptions,'host'|'port'> & {schemaVersion:number;payload:Buffer;confirmed?:boolean;eventId?:Buffer;timestampSec?:number;nonce?:Buffer}):Buffer;
export function verifyTelemetryReceipt(receipt:Buffer,frameMac:Buffer,secret:string):boolean;
