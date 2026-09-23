#include "struct_socket.h"
#include <errno.h>
#include <string.h>
#if defined(STRUCT_PORT_ZEPHYR)
#include <zephyr/net/socket.h>
#include <zephyr/random/random.h>
#include "struct_psa.h"
#define S_SOCKET zsock_socket
#define S_CONNECT zsock_connect
#define S_CLOSE zsock_close
#define S_SEND zsock_send
#define S_RECV zsock_recv
#define S_FCNTL zsock_fcntl
#define S_INET zsock_inet_pton
#elif defined(STRUCT_PORT_ESP_IDF) || defined(STRUCT_PORT_LWIP)
#include <lwip/sockets.h>
#include <lwip/inet.h>
#include "struct_mbedtls.h"
#ifdef STRUCT_PORT_ESP_IDF
#include <esp_random.h>
#endif
#define S_SOCKET lwip_socket
#define S_CONNECT lwip_connect
#define S_CLOSE lwip_close
#define S_SEND lwip_send
#define S_RECV lwip_recv
#define S_FCNTL lwip_fcntl
#define S_INET inet_pton
#else
#error Select STRUCT_PORT_ESP_IDF, STRUCT_PORT_ZEPHYR or STRUCT_PORT_LWIP
#endif
static int random_bytes(void *user,uint8_t *out,size_t n){
#ifdef STRUCT_PORT_ESP_IDF
 (void)user;esp_fill_random(out,n);return 0;
#elif defined(STRUCT_PORT_ZEPHYR)
 (void)user;return sys_csrand_get(out,n);
#else
 struct_socket *s=user;return s->entropy?s->entropy(s->entropy_user,out,n):-1;
#endif
}
static int send_bytes(void *user,const uint8_t *bytes,size_t n){return S_SEND(((struct_socket*)user)->fd,bytes,n,0)==(int)n?0:-1;}
static int receive_bytes(void *user,uint8_t *out,size_t n){int got=S_RECV(((struct_socket*)user)->fd,out,n,MSG_TRUNC);if(got<0&&(errno==EAGAIN||errno==EWOULDBLOCK||errno==EINTR))return 0;return got;}
void struct_socket_close(struct_socket *s){if(s&&s->opened){S_CLOSE(s->fd);s->opened=0;s->fd=-1;}}
int struct_socket_open(struct_socket *s,struct_port *callbacks,const char *ip,uint16_t port){
 struct sockaddr_in remote;int flags;
 if(!s||!callbacks||!ip||!port||s->opened)return -1;
 memset(callbacks,0,sizeof(*callbacks));memset(&remote,0,sizeof(remote));remote.sin_family=AF_INET;remote.sin_port=htons(port);
 if(S_INET(AF_INET,ip,&remote.sin_addr)!=1)return -1;
 s->fd=S_SOCKET(AF_INET,SOCK_DGRAM,IPPROTO_UDP);if(s->fd<0)return -1;s->opened=1;
 flags=S_FCNTL(s->fd,F_GETFL,0);
 if(flags<0||S_FCNTL(s->fd,F_SETFL,flags|O_NONBLOCK)<0||S_CONNECT(s->fd,(struct sockaddr*)&remote,sizeof(remote))<0){struct_socket_close(s);return -1;}
 callbacks->user=s;callbacks->random=random_bytes;callbacks->send=send_bytes;callbacks->receive=receive_bytes;
#ifdef STRUCT_PORT_ZEPHYR
 if(psa_crypto_init()!=PSA_SUCCESS){struct_socket_close(s);return -1;}
 callbacks->hmac=struct_psa_hmac;callbacks->encrypt=struct_psa_encrypt;
#else
 callbacks->hmac=struct_mbedtls_hmac;
#if defined(MBEDTLS_CHACHAPOLY_C)
 callbacks->encrypt=struct_mbedtls_encrypt;
#endif
#endif
 return 0;
}
