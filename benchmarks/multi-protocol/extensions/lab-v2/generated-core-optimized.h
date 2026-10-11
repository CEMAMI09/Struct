#ifndef STRUCT_GENERATED_PACKED_PACKET_H
#define STRUCT_GENERATED_PACKED_PACKET_H
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include <string.h>
#include <math.h>
#include <float.h>
#if DBL_MANT_DIG != 53 || DBL_MAX_EXP != 1024
#error "Struct float64 requires IEEE 754 binary64"
#endif
#if FLT_RADIX != 2 || FLT_MANT_DIG != 24 || FLT_MAX_EXP != 128
#error "Struct float fields require IEEE 754 binary32"
#endif
#define STRUCT_SCHEMA_SLOT 1u
#define STRUCT_SCHEMA_ENCODING "bitpacked-v1"
#define STRUCT_PACKET_BITS 1493u
#define STRUCT_PACKET_SIZE 187u
#define STRUCT_ENUM_state_0 0u /* off */
#define STRUCT_ENUM_state_1 1u /* on */
#define STRUCT_ENUM_state_2 2u /* idle */
typedef struct {
  bool f_flag;
  int32_t f_int8;
  int32_t f_int16;
  int32_t f_int32;
  int64_t f_int64;
  uint32_t f_uint8;
  uint32_t f_uint16;
  uint32_t f_uint32;
  uint64_t f_uint64;
  double f_double;
  float f_single;
  double f_half;
  uint64_t f_time;
  uint32_t f_bits;
  struct { uint16_t length; uint8_t data[64]; } f_label;
  struct { uint16_t length; uint8_t data[64]; } f_raw;
  uint32_t f_state;
  double f_decimal;
} StructPacket;
static inline void struct_pack_bits(uint8_t *out, size_t offset, unsigned width, uint64_t code) {
  for (unsigned i=0; i<width; i++) if ((code >> (width-i-1)) & 1u) out[(offset+i)/8] |= (uint8_t)(1u << (7u-(offset+i)%8));
}
static inline double struct_pack_round_even(double value) { double low=floor(value), fraction=value-low; return fraction>0.5 || (fraction==0.5 && fmod(low,2.0)!=0) ? low+1 : low; }
static inline int struct_pack_f16(double value, uint32_t *out) {
  if (!isfinite(value)) return 0; uint32_t sign=signbit(value)?0x8000u:0; double a=fabs((double)value);
  if (a==0) { *out=sign; return 1; }
  if (a < 0x1p-14) { *out=sign+(uint32_t)struct_pack_round_even(a*0x1p24); return 1; }
  int exponent; (void)frexp(a,&exponent); exponent--; double mantissa=struct_pack_round_even((a/ldexp(1.0,exponent)-1.0)*1024.0);
  if (mantissa==1024) { exponent++; mantissa=0; } if (exponent>15) return 0;
  *out=sign+(uint32_t)(exponent+15)*1024u+(uint32_t)mantissa; return 1;
}
static inline int struct_pack_utf8(const uint8_t *data, size_t n) { size_t i=0; while(i<n){ uint32_t c=data[i++], minimum=0; unsigned following=0; if(c<0x80)continue; if(c>=0xc2 && c<=0xdf){c&=31;minimum=0x80;following=1;}else if(c>=0xe0 && c<=0xef){c&=15;minimum=0x800;following=2;}else if(c>=0xf0 && c<=0xf4){c&=7;minimum=0x10000;following=3;}else return 0; if(n-i<following)return 0;while(following--){uint8_t b=data[i++];if((b&0xc0)!=0x80)return 0;c=(c<<6)|(b&63);}if(c<minimum || c>0x10ffff || (c>=0xd800 && c<=0xdfff))return 0;} return 1; }
/* Explicit bit writers; neither member layout nor native byte order is transmitted. */
static inline size_t struct_pack_packet(uint8_t *out, size_t capacity, const StructPacket *p) {
  if (!out || !p || capacity < STRUCT_PACKET_SIZE || sizeof(float)!=4 || sizeof(double)!=8) return 0;
  uint32_t code_0 = p->f_flag ? 1u : 0u;
  if ((double)p->f_int8 < -128.0 || (double)p->f_int8 > 127.0) return 0;
  uint32_t code_1 = (uint32_t)p->f_int8;
  code_1 &= 255u;
  if ((double)p->f_int16 < -32768.0 || (double)p->f_int16 > 32767.0) return 0;
  uint32_t code_2 = (uint32_t)p->f_int16;
  code_2 &= 65535u;
  if ((double)p->f_int32 < -2147483648.0 || (double)p->f_int32 > 2147483647.0) return 0;
  uint32_t code_3 = (uint32_t)p->f_int32;
  if (p->f_int64 < INT64_MIN || p->f_int64 > INT64_C(9223372036854775807)) return 0;
  uint64_t code_4 = (uint64_t)p->f_int64;
  if ((double)p->f_uint8 < 0.0 || (double)p->f_uint8 > 255.0) return 0;
  uint32_t code_5 = (uint32_t)p->f_uint8;
  if ((double)p->f_uint16 < 0.0 || (double)p->f_uint16 > 65535.0) return 0;
  uint32_t code_6 = (uint32_t)p->f_uint16;
  if ((double)p->f_uint32 < 0.0 || (double)p->f_uint32 > 4294967295.0) return 0;
  uint32_t code_7 = (uint32_t)p->f_uint32;
  if (p->f_uint64 < UINT64_C(0) || p->f_uint64 > UINT64_C(18446744073709551615)) return 0;
  uint64_t code_8 = (uint64_t)p->f_uint64;
  uint64_t code_9; if (!isfinite(p->f_double)) return 0; memcpy(&code_9, &p->f_double, 8);
  uint32_t code_10; if (!isfinite(p->f_single)) return 0; memcpy(&code_10, &p->f_single, 4);
  uint32_t code_11; if (!struct_pack_f16(p->f_half, &code_11)) return 0;
  if (p->f_time < UINT64_C(0) || p->f_time > UINT64_C(18446744073709551615)) return 0;
  uint64_t code_12 = (uint64_t)p->f_time;
  if ((double)p->f_bits < 0.0 || (double)p->f_bits > 255.0) return 0;
  uint32_t code_13 = (uint32_t)p->f_bits;
  if (p->f_label.length > 64u) return 0;
  if (!struct_pack_utf8(p->f_label.data, p->f_label.length)) return 0;
  if (p->f_raw.length > 64u) return 0;
  if (p->f_state >= 3u) return 0;
  uint32_t code_16 = p->f_state;
  double value_17 = p->f_decimal;
  if (!isfinite(value_17)) return 0;
  if (value_17 < 0.0 - 0.01 * 1e-7 || value_17 > 10.0 + 0.01 * 1e-7) return 0;
  if (value_17 < 0.0) value_17 = 0.0;
  if (value_17 > 10.0) value_17 = 10.0;
  double rounded_17 = floor((value_17 - 0.0) / 0.01 + 0.5 + 1e-7);
  if (rounded_17 < 0 || rounded_17 >= 1001.0) return 0;
  uint32_t code_17 = (uint32_t)rounded_17;
  memset(out,0,STRUCT_PACKET_SIZE);
  struct_pack_bits(out, 0u, 1u, code_0);
  struct_pack_bits(out, 1u, 8u, code_1);
  struct_pack_bits(out, 9u, 16u, code_2);
  struct_pack_bits(out, 25u, 32u, code_3);
  struct_pack_bits(out, 57u, 64u, code_4);
  struct_pack_bits(out, 121u, 8u, code_5);
  struct_pack_bits(out, 129u, 16u, code_6);
  struct_pack_bits(out, 145u, 32u, code_7);
  struct_pack_bits(out, 177u, 64u, code_8);
  struct_pack_bits(out, 241u, 64u, code_9);
  struct_pack_bits(out, 305u, 32u, code_10);
  struct_pack_bits(out, 337u, 16u, code_11);
  struct_pack_bits(out, 353u, 64u, code_12);
  struct_pack_bits(out, 417u, 8u, code_13);
  struct_pack_bits(out, 425u, 16u, p->f_label.length);
  for(unsigned byte_14=0; byte_14<p->f_label.length;byte_14++) struct_pack_bits(out, 441u+byte_14*8u, 8u, p->f_label.data[byte_14]);
  struct_pack_bits(out, 953u, 16u, p->f_raw.length);
  for(unsigned byte_15=0; byte_15<p->f_raw.length;byte_15++) struct_pack_bits(out, 969u+byte_15*8u, 8u, p->f_raw.data[byte_15]);
  struct_pack_bits(out, 1481u, 2u, code_16);
  struct_pack_bits(out, 1483u, 10u, code_17);
  return STRUCT_PACKET_SIZE;
}
#endif
