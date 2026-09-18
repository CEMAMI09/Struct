#include "struct_queue.h"
#include <string.h>
static uint32_t get32(const uint8_t*p){return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24;}
static uint32_t crc(const uint8_t*p,size_t n){uint32_t c=0xffffffffu;unsigned i;while(n--){c^=*p++;for(i=0;i<8;i++)c=(c>>1)^(0xedb88320u&((uint32_t)0-(c&1)));}return ~c;}
static int valid(const uint8_t*b){unsigned i;if(memcmp(b,"STQ1",4)||b[8]>4||get32(b+32)!=crc(b+40,STRUCT_QUEUE_BYTES-40))return 0;for(i=0;i<b[8];i++){const uint8_t*r=b+40+i*STRUCT_QUEUE_RECORD;unsigned n=r[21]|(unsigned)r[22]<<8;if(!r[16]||n<1||n>1286)return 0;}return 1;}
/* Header checksum also covers generation, count and credential identity. */
static uint32_t header_crc(const uint8_t*b){return crc(b,28);}
static int intact(const uint8_t*b){return valid(b)&&get32(b+28)==header_crc(b);}
static int commit(struct_queue*q,uint8_t*b){unsigned next=1-q->slot;struct_put_u32(b+4,get32(q->bytes+4)+1);struct_put_u32(b+32,crc(b+40,STRUCT_QUEUE_BYTES-40));struct_put_u32(b+28,header_crc(b));if(q->port.write(q->port.user,next,b,STRUCT_QUEUE_BYTES)){q->active=-1;return STRUCT_IO_ERROR;}memcpy(q->bytes,b,STRUCT_QUEUE_BYTES);q->slot=next;return 0;}
int struct_queue_open(struct_queue*q,const struct_queue_port*p,const char key[16]){
 uint8_t b[STRUCT_QUEUE_BYTES];int na,nb,va,vb;
 if(!q||!p||!p->read||!p->write||!key)return STRUCT_INVALID;
 memset(q,0,sizeof(*q));q->port=*p;na=p->read(p->user,0,q->bytes,STRUCT_QUEUE_BYTES);nb=p->read(p->user,1,b,sizeof(b));
 if(na<0||nb<0)return STRUCT_IO_ERROR;
 va=na==(int)STRUCT_QUEUE_BYTES&&intact(q->bytes);vb=nb==(int)sizeof(b)&&intact(b);
 if(!va&&!vb){if(na||nb)return STRUCT_IO_ERROR;memcpy(q->bytes,"STQ1",4);memcpy(q->bytes+9,key,16);memcpy(b,q->bytes,sizeof(b));return commit(q,b);}
 q->slot=vb&&(!va||(int32_t)(get32(b+4)-get32(q->bytes+4))>0)?1:0;
 if(q->slot)memcpy(q->bytes,b,sizeof(b));
 if(memcmp(q->bytes+9,key,16))return STRUCT_INVALID;
 return 0;
}
int struct_queue_enqueue(struct_queue*q,struct_client*c,uint8_t version,const uint8_t*payload,size_t n,uint32_t expires){
 uint8_t b[STRUCT_QUEUE_BYTES],*r;
 if(!q||!c||!c->port.random||q->active||!version||!payload||n<1||n>1286||!expires)return STRUCT_INVALID;
 if(q->bytes[8]>=4)return STRUCT_QUEUE_FULL;
 memcpy(b,q->bytes,sizeof(b));r=b+40+b[8]*STRUCT_QUEUE_RECORD;
 if(c->port.random(c->port.user,r,16))return STRUCT_CRYPTO_ERROR;
 r[16]=version;struct_put_u32(r+17,expires);r[21]=(uint8_t)n;r[22]=(uint8_t)(n>>8);memcpy(r+23,payload,n);b[8]++;
 return commit(q,b);
}
int struct_queue_discard_head(struct_queue*q){uint8_t b[STRUCT_QUEUE_BYTES];if(!q||q->active||!q->bytes[8])return STRUCT_INVALID;memcpy(b,q->bytes,sizeof(b));b[8]--;memmove(b+40,b+40+STRUCT_QUEUE_RECORD,b[8]*STRUCT_QUEUE_RECORD);memset(b+40+b[8]*STRUCT_QUEUE_RECORD,0,STRUCT_QUEUE_RECORD);return commit(q,b);}
int struct_queue_step(struct_queue*q,struct_client*c,uint32_t unix_sec,uint32_t now,struct_delivery d){
 const uint8_t*r;int status;
 if(!q||!c||!unix_sec||!d.confirmed)return STRUCT_INVALID;
 if(q->active<0)return STRUCT_IO_ERROR;
 if(memcmp(q->bytes+9,c->key_id,16))return STRUCT_INVALID;
 if(!q->bytes[8])return STRUCT_IDLE;
 r=q->bytes+40;
 if(q->active){status=struct_poll(c,now);if(status==STRUCT_PENDING)return status;q->active=0;if(status==STRUCT_COMMITTED){int saved=struct_queue_discard_head(q);if(saved)return saved;}return status;}
 if(get32(r+17)<=unix_sec)return STRUCT_QUEUE_EXPIRED;
 status=struct_send_event(c,r,r[16],r+23,r[21]|(size_t)r[22]<<8,unix_sec,now,d);q->active=status==STRUCT_PENDING;return status;
}
