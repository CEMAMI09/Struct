#ifndef STRUCT_MANAGEMENT_CRYPTO_H
#define STRUCT_MANAGEMENT_CRYPTO_H
/* Optional: included only by the management agent. Uses platform mbedTLS;
 * no custom signature algorithm or telemetry crypto changes. */
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <mbedtls/version.h>
#include <mbedtls/md.h>
#include <mbedtls/hkdf.h>
#include <mbedtls/pk.h>
#include <mbedtls/ecp.h>
#if MBEDTLS_VERSION_MAJOR >= 3
#define STRUCT_M_PRIVATE(x) MBEDTLS_PRIVATE(x)
#else
#define STRUCT_M_PRIVATE(x) x
#endif
static inline int struct_management_derive(const uint8_t root[32],uint32_t wire,uint8_t key[32]) {
 uint8_t salt[4]={(uint8_t)(wire>>24),(uint8_t)(wire>>16),(uint8_t)(wire>>8),(uint8_t)wire};
 const char info[]="struct.management.v1";
 return mbedtls_hkdf(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),salt,4,root,32,(const uint8_t*)info,sizeof(info)-1,key,32);
}
static inline int struct_management_sha256(const void *bytes,size_t length,uint8_t digest[32]) {return mbedtls_md(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),(const uint8_t*)bytes,length,digest);}
static inline int struct_management_mac(const uint8_t key[32],uint32_t wire,const char *id,const char *nonce,const char *hash,uint8_t out[32]) {
 char message[256];int n;if(strlen(id)!=36||strlen(nonce)!=64||strlen(hash)!=64)return -1;
 n=snprintf(message,sizeof(message),"STRUCT-MANAGEMENT-V1\n%lu\n%s\n%s\n%s",(unsigned long)wire,id,nonce,hash);
 return n<0||(size_t)n>=sizeof(message)?-1:mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),key,32,(const uint8_t*)message,n,out);
}
static inline int struct_management_fingerprint(const char *pem,uint8_t out[32]) {
#if defined(MBEDTLS_PK_WRITE_C)
 mbedtls_pk_context key;uint8_t der[256];int result;mbedtls_pk_init(&key);
 if(!pem||strlen(pem)>2048)return -1;
 result=mbedtls_pk_parse_public_key(&key,(const uint8_t*)pem,strlen(pem)+1);
 if(!result&&(!mbedtls_pk_can_do(&key,MBEDTLS_PK_ECDSA)||mbedtls_pk_ec(key)->STRUCT_M_PRIVATE(grp).id!=MBEDTLS_ECP_DP_SECP256R1))result=-1;
 if(!result){int length=mbedtls_pk_write_pubkey_der(&key,der,sizeof(der));result=length>0?struct_management_sha256(der+sizeof(der)-length,length,out):-1;}
 mbedtls_pk_free(&key);return result;
#else
 (void)pem;(void)out;return -1; // No unverifiable trust configuration fallback.
#endif
}
static inline int struct_management_verify(const char *pem,const uint8_t *canonical,size_t length,const uint8_t *signature,size_t signature_size) {
 mbedtls_pk_context key;uint8_t hash[32];int result;mbedtls_pk_init(&key);
 if(!pem||!canonical||length>1024||!signature||signature_size>80)return -1;
 result=mbedtls_pk_parse_public_key(&key,(const uint8_t*)pem,strlen(pem)+1);
 if(!result&&(!mbedtls_pk_can_do(&key,MBEDTLS_PK_ECDSA)||mbedtls_pk_ec(key)->STRUCT_M_PRIVATE(grp).id!=MBEDTLS_ECP_DP_SECP256R1))result=-1;
 if(!result)result=struct_management_sha256(canonical,length,hash);
 if(!result)result=mbedtls_pk_verify(&key,MBEDTLS_MD_SHA256,hash,32,signature,signature_size);
 mbedtls_pk_free(&key);memset(hash,0,sizeof(hash));return result;
}
typedef struct {char artifact_id[37],organization_id[37],key_id[37],platform[9],model[65],revision[65],version[65],sha256[65];uint32_t security_version,min_agent,min_bootloader,size;} struct_management_manifest;
static inline int struct_management_number(const char *s,uint32_t maximum,uint32_t *out){uint64_t n=0;if(!*s||(*s=='0'&&s[1]))return -1;while(*s){if(*s<'0'||*s>'9')return -1;n=n*10+(*s++-'0');if(n>maximum)return -1;}*out=(uint32_t)n;return 0;}
static inline int struct_management_token(const char *s,size_t maximum){size_t n=strlen(s);if(!n||n>maximum)return -1;for(size_t i=0;i<n;i++)if(!((s[i]>='A'&&s[i]<='Z')||(s[i]>='a'&&s[i]<='z')||(s[i]>='0'&&s[i]<='9')||s[i]=='.'||s[i]=='_'||s[i]=='-'))return -1;return 0;}
static inline int struct_management_uuid(const char *s){if(strlen(s)!=36)return -1;for(size_t i=0;i<36;i++){if(i==8||i==13||i==18||i==23){if(s[i]!='-')return -1;}else if(!((s[i]>='a'&&s[i]<='f')||(s[i]>='0'&&s[i]<='9')))return -1;}return 0;}
static inline int struct_management_parse(const char *canonical,size_t length,struct_management_manifest *out){
 char copy[1025],*lines[14],*cursor;size_t count=0;if(!canonical||!out||!length||length>1024||canonical[length-1]!='\n'||memchr(canonical,0,length))return -1;
 memcpy(copy,canonical,length);copy[length]=0;cursor=copy;while(*cursor&&count<14){lines[count++]=cursor;char *end=strchr(cursor,'\n');if(!end)return -1;*end=0;cursor=end+1;}if(count!=14||*cursor||strcmp(lines[0],"STRUCT-FIRMWARE-MANIFEST-V1"))return -1;
 if(struct_management_uuid(lines[1])||struct_management_uuid(lines[2])||struct_management_uuid(lines[3])||(strcmp(lines[4],"esp32")&&strcmp(lines[4],"esp32c3"))||strcmp(lines[5],"persistent-nvs-v1")||struct_management_token(lines[6],64)||struct_management_token(lines[7],64)||struct_management_token(lines[8],64))return -1;
 if(struct_management_number(lines[9],2147483647,&out->security_version)||struct_management_number(lines[10],1,&out->min_agent)||out->min_agent!=1||struct_management_number(lines[11],65535,&out->min_bootloader)||struct_management_number(lines[12],4194304,&out->size)||out->size<256||strlen(lines[13])!=64)return -1;
 for(size_t i=0;i<64;i++)if(!((lines[13][i]>='a'&&lines[13][i]<='f')||(lines[13][i]>='0'&&lines[13][i]<='9')))return -1;
 strcpy(out->artifact_id,lines[1]);strcpy(out->organization_id,lines[2]);strcpy(out->key_id,lines[3]);strcpy(out->platform,lines[4]);strcpy(out->model,lines[6]);strcpy(out->revision,lines[7]);strcpy(out->version,lines[8]);strcpy(out->sha256,lines[13]);return 0;
}
#endif
