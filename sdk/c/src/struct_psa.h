#ifndef STRUCT_PSA_H
#define STRUCT_PSA_H
#include "struct_sdk.h"
#include <psa/crypto.h>
#include <string.h>
/* PSA key handles are destroyed on every path. Backend allocation is separate
 * from the allocation-free C core. Enable HMAC-SHA256 and ChaCha20-Poly1305. */
static inline int struct_psa_hmac(void *u,const uint8_t *key,size_t key_n,const uint8_t *data,size_t n,uint8_t out[32]){
 psa_key_attributes_t a=PSA_KEY_ATTRIBUTES_INIT;psa_key_id_t id=0;psa_status_t rc;size_t written=0;(void)u;
 psa_set_key_type(&a,PSA_KEY_TYPE_HMAC);psa_set_key_usage_flags(&a,PSA_KEY_USAGE_SIGN_MESSAGE);psa_set_key_algorithm(&a,PSA_ALG_HMAC(PSA_ALG_SHA_256));
 rc=psa_import_key(&a,key,key_n,&id);psa_reset_key_attributes(&a);
 if(rc==PSA_SUCCESS)rc=psa_mac_compute(id,PSA_ALG_HMAC(PSA_ALG_SHA_256),data,n,out,32,&written);
 if(id)psa_destroy_key(id);return rc==PSA_SUCCESS&&written==32?0:-1;
}
static inline int struct_psa_encrypt(void *u,const uint8_t key[32],const uint8_t nonce[12],const uint8_t *plain,size_t n,uint8_t *cipher,uint8_t tag[16]){
 psa_key_attributes_t a=PSA_KEY_ATTRIBUTES_INIT;psa_key_id_t id=0;psa_status_t rc;size_t written=0;uint8_t buffer[STRUCT_MAX_FRAME];volatile uint8_t *wipe=buffer;size_t i;(void)u;
 if(n+16>sizeof(buffer))return -1;
 psa_set_key_type(&a,PSA_KEY_TYPE_CHACHA20);psa_set_key_usage_flags(&a,PSA_KEY_USAGE_ENCRYPT);psa_set_key_algorithm(&a,PSA_ALG_CHACHA20_POLY1305);
 rc=psa_import_key(&a,key,32,&id);psa_reset_key_attributes(&a);
 if(rc==PSA_SUCCESS)rc=psa_aead_encrypt(id,PSA_ALG_CHACHA20_POLY1305,nonce,12,NULL,0,plain,n,buffer,sizeof(buffer),&written);
 if(id)psa_destroy_key(id);
 if(rc==PSA_SUCCESS&&written==n+16){memcpy(cipher,buffer,n);memcpy(tag,buffer+n,16);}else rc=PSA_ERROR_GENERIC_ERROR;
 for(i=0;i<sizeof(buffer);i++)wipe[i]=0;
 return rc==PSA_SUCCESS?0:-1;
}
#endif
