import type {StructClient,Delivery,Outcome} from './index';
export class PersistentQueue {
 constructor(file:string,options:{keyId:string;capacity?:number;recover?:boolean});
 enqueue(version:number,payload:Buffer,options?:{now?:number;ttlSeconds?:number}):string;
 flushOne(client:StructClient,delivery?:Delivery):Promise<(Outcome&{id:string})|{status:'empty'}|{status:'expired';id:string}>;
 discard(id:string):void;
 close():void;
}
