#include "struct_commands.h"
#include <string.h>
static uint32_t read32(const uint8_t *p) { return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24; }
static int same(const uint8_t *a,const uint8_t *b,size_t n) { uint8_t d=0; while(n--) d|=*a++^*b++; return !d; }
int struct_command_handle(struct_client *c,const uint8_t *f,size_t n,uint32_t now,const struct_command_port *p) {
  uint8_t mac[32]; int previous,result; uint32_t expires;
  if(!c||!p||!p->load||!p->save||!p->execute||!c->port.hmac||!f||n<77||n>1400||memcmp(f,"STRC",4)||memcmp(f+4,c->key_id,16)) return STRUCT_INVALID;
  if(c->port.hmac(c->port.user,c->secret,64,f,n-32,mac)||!same(mac,f+n-32,32)) return STRUCT_CRYPTO_ERROR;
  expires=read32(f+40);
  if(expires<=now) return STRUCT_COMMAND_EXPIRED;
  if((uint64_t)read32(f+36)>(uint64_t)now+60||expires<=read32(f+36)) return STRUCT_INVALID;
  previous=p->load(p->user,f+20,mac);
  if(previous<0) return STRUCT_IO_ERROR;
  if(previous && (previous<STRUCT_COMMAND_RECEIVED || previous>STRUCT_COMMAND_UNKNOWN)) return STRUCT_IO_ERROR;
  if(previous) return previous==STRUCT_COMMAND_RECEIVED?STRUCT_COMMAND_UNKNOWN:previous;
  /* Commit intent BEFORE touching hardware. A reset leaves UNKNOWN; it must not
   * blindly rerun a possibly completed reboot/motor action. */
  if(p->save(p->user,f+20,mac,expires,STRUCT_COMMAND_RECEIVED)) return STRUCT_IO_ERROR;
  result=p->execute(p->user,f+20,f+44,n-76);
  if(result!=STRUCT_COMMAND_EXECUTED&&result!=STRUCT_COMMAND_REJECTED) result=STRUCT_COMMAND_UNKNOWN;
  if(p->save(p->user,f+20,mac,expires,result)) return STRUCT_COMMAND_UNKNOWN;
  return result;
}
int struct_command_ack(struct_client *c,const uint8_t id[16],int status,uint8_t out[67]) {
  if(!c||!id||!out||!c->port.hmac||status<16||status>20) return STRUCT_INVALID;
  out[0]=2;memcpy(out+1,c->key_id,16);out[17]=0;memcpy(out+18,id,16);out[34]=(uint8_t)status;
  return c->port.hmac(c->port.user,c->secret,64,out,35,out+35)?STRUCT_CRYPTO_ERROR:0;
}
