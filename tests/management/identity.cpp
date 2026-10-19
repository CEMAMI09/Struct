#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "StructManagedIdentityEsp32.h"
static unsigned char saved[128],staged[128];static size_t size=0,pending=0;static bool fail=false;
int nvs_open(const char *name,int mode,nvs_handle_t *h){assert(!strcmp(name,"sv2_identity"));*h=1;return !size&&mode==NVS_READONLY?ESP_ERR_NVS_NOT_FOUND:ESP_OK;}
void nvs_close(nvs_handle_t){}
int nvs_get_blob(nvs_handle_t,const char *key,void *out,size_t *n){assert(!strcmp(key,"identity"));if(!size)return ESP_ERR_NVS_NOT_FOUND;if(*n<size)return -1;memcpy(out,saved,size);*n=size;return 0;}
int nvs_set_blob(nvs_handle_t,const char*,const void *in,size_t n){assert(n<=sizeof(staged));memcpy(staged,in,n);pending=n;return 0;}
int nvs_commit(nvs_handle_t){if(fail)return -1;memcpy(saved,staged,pending);size=pending;return 0;}
int main(){uint32_t wire=0;char root[65]{};const char *first="1212121212121212121212121212121212121212121212121212121212121212",*second="3434343434343434343434343434343434343434343434343434343434343434";
assert(StructManagedIdentityEsp32::load(wire,root)==1);assert(!StructManagedIdentityEsp32::provision(1,first,false));assert(StructManagedIdentityEsp32::provision(1,first,true));assert(!StructManagedIdentityEsp32::load(wire,root)&&wire==1&&!strcmp(root,first));
assert(!StructManagedIdentityEsp32::provision(2,second,true));assert(!StructManagedIdentityEsp32::load(wire,root)&&wire==1);assert(!StructManagedIdentityEsp32::provision(1,second,true,true));assert(StructManagedIdentityEsp32::provision(2,second,true,true));assert(!StructManagedIdentityEsp32::load(wire,root)&&wire==2&&!strcmp(root,second));
fail=true;assert(!StructManagedIdentityEsp32::provision(3,first,true,true));fail=false;assert(!StructManagedIdentityEsp32::load(wire,root)&&wire==2);assert(!StructManagedIdentityEsp32::provision(3,"0000000000000000000000000000000000000000000000000000000000000000",true,true));saved[0]^=1;assert(StructManagedIdentityEsp32::load(wire,root)==-1);
puts("PASS 13 real C++ identity-loader checks with an explicit in-memory NVS fixture (not physical flash)");return 0;}
