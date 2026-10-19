/** Nonsecret deployment-specific SDK configuration; never weaken bootstrap TLS. */
export function ingestEndpoint(){
 const host=process.env.STRUCT_INGEST_HOST||'ingest.usestruct.com',port=Number(process.env.STRUCT_INGEST_PORT||8081),bootstrapOrigin=process.env.STRUCT_BOOTSTRAP_ORIGIN||'https://www.usestruct.com'
 if(!/^[a-zA-Z0-9.-]{1,253}$/.test(host)||!Number.isInteger(port)||port<1||port>65535)throw createError({statusCode:503,message:'Ingestion endpoint configuration invalid.'})
 const u=new URL(bootstrapOrigin);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw createError({statusCode:503,message:'Bootstrap requires an authenticated HTTPS origin.'})
 return{host,port,bootstrapOrigin:u.origin}
}
