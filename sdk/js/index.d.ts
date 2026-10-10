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
export interface SequenceCounterOptions {wireDeviceId:number;rootSecret:string|Buffer;blockSize?:number;recover?:boolean;trustedProvisioning?:boolean;initialSequence?:number}
export class PersistentSequenceCounter {
 constructor(file:string,options:SequenceCounterOptions);
 readonly wireDeviceId:number;
 next():number;
 close():void;
 static provision(file:string,options:Omit<SequenceCounterOptions,'trustedProvisioning'|'initialSequence'|'recover'>&{bootstrapToken:string;bootstrapOrigin?:string}):Promise<PersistentSequenceCounter>;
}
export interface SecureV2ClientOptions {wireDeviceId:number;rootSecret:string|Buffer;counter:{next:()=>number|Promise<number>;wireDeviceId?:number};host?:string;port?:number;maximum?:number}
export interface SecureV2Outcome extends Outcome {protocol:'Struct Secure V2';cipher:'ChaCha20-Poly1305';sequence:number;schema_slot:number;payload_bytes:number;frame_bytes:number;ipv4_udp_bytes:number;receipt_requested:boolean;receipt_bytes:number;batch_count:number}
export class SecureV2Client {
 constructor(options:SecureV2ClientOptions);
 send(slot:number,payload:Buffer,delivery?:Omit<Delivery,'eventId'>):Promise<SecureV2Outcome>;
 sendBatch(slot:number,records:Buffer[],delivery?:Omit<Delivery,'eventId'>):Promise<SecureV2Outcome[]>;
}
