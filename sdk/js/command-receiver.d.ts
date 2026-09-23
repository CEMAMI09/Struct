export interface Command {commandId:string;expires:number;expired:boolean;payload:Buffer}
export type CommandStatus='received'|'executed'|'rejected'|'expired'|'unknown';
export class CommandReceiver {
 constructor(file:string,options:{keyId:string;secret:string;capacity?:number;recover?:boolean});
 handle(frame:Buffer,execute:(command:Command)=>Promise<'executed'|'rejected'|void>,ack?:(frame:Buffer)=>Promise<void>,now?:number):Promise<CommandStatus>;
 close():void;
}
