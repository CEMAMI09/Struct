# Actual generated C Secure V2 bytes

These are the actual C/mbedTLS SDK outputs from the reproduced local ESP32-schema pilot. Public disposable test root and the full decoder/receipt/tamper evidence are retained in `results/raw/struct-esp32-pilot.json`. No production credentials were used.

## original, unconfirmed

Payload: `00 00 BC 41 00 00 75 42 01`

Complete application datagram:

```text
84 00 00 00 01 00 00 00 00 0E FC DF B9 C6 14 BD 38 92 4D F5 BD B2 06 77 AC E5 50 02 09 B0 C9 8E B1 89
```

| Region | Offset | Bytes | Actual hex |
| --- | --- | --- | --- |
| control: generation + slot + confirmed + batch | 0 | 1 | 84 |
| wire device ID (BE32) | 1 | 4 | 00 00 00 01 |
| sequence (BE32) | 5 | 4 | 00 00 00 00 |
| encrypted sensor payload | 9 | 9 | 0E FC DF B9 C6 14 BD 38 92 |
| Poly1305 authentication tag | 18 | 16 | 4D F5 BD B2 06 77 AC E5 50 02 09 B0 C9 8E B1 89 |

Decoded: `{"temp": 23.5, "humidity": 61.25, "is_active": true}`

## original, confirmed

Payload: `00 00 BC 41 00 00 75 42 01`

Complete application datagram:

```text
86 00 00 00 01 00 00 00 01 58 81 68 78 58 DB CF E7 B1 22 D5 FF 25 C3 24 D6 38 72 A5 11 A2 AC C2 D1 FE
```

| Region | Offset | Bytes | Actual hex |
| --- | --- | --- | --- |
| control: generation + slot + confirmed + batch | 0 | 1 | 86 |
| wire device ID (BE32) | 1 | 4 | 00 00 00 01 |
| sequence (BE32) | 5 | 4 | 00 00 00 01 |
| encrypted sensor payload | 9 | 9 | 58 81 68 78 58 DB CF E7 B1 |
| Poly1305 authentication tag | 18 | 16 | 22 D5 FF 25 C3 24 D6 38 72 A5 11 A2 AC C2 D1 FE |

Receipt: `C0 00 00 00 01 35 16 40 95 86 89 EB 15 AA D6 4B D7 D4 5D E1 77`

Decoded: `{"temp": 23.5, "humidity": 61.25, "is_active": true}`

## optimized, unconfirmed

Payload: `4F 73 2C`

Complete application datagram:

```text
88 00 00 00 02 00 00 00 00 54 74 E1 FF D7 B1 01 90 ED ED 7B 01 4E F4 D3 63 68 39 87
```

| Region | Offset | Bytes | Actual hex |
| --- | --- | --- | --- |
| control: generation + slot + confirmed + batch | 0 | 1 | 88 |
| wire device ID (BE32) | 1 | 4 | 00 00 00 02 |
| sequence (BE32) | 5 | 4 | 00 00 00 00 |
| encrypted sensor payload | 9 | 3 | 54 74 E1 |
| Poly1305 authentication tag | 12 | 16 | FF D7 B1 01 90 ED ED 7B 01 4E F4 D3 63 68 39 87 |

Decoded: `{"temp": 23.5, "humidity": 61.300000000000004, "is_active": true}`

## optimized, confirmed

Payload: `4F 73 2C`

Complete application datagram:

```text
8A 00 00 00 02 00 00 00 01 2A AA BF D6 72 F4 3D 04 B3 0B 27 70 A2 60 80 32 C0 D2 99
```

| Region | Offset | Bytes | Actual hex |
| --- | --- | --- | --- |
| control: generation + slot + confirmed + batch | 0 | 1 | 8A |
| wire device ID (BE32) | 1 | 4 | 00 00 00 02 |
| sequence (BE32) | 5 | 4 | 00 00 00 01 |
| encrypted sensor payload | 9 | 3 | 2A AA BF |
| Poly1305 authentication tag | 12 | 16 | D6 72 F4 3D 04 B3 0B 27 70 A2 60 80 32 C0 D2 99 |

Receipt: `C0 00 00 00 01 25 2D CF 8A EE 39 33 BC A3 7F 7A 4F DF 2C 69 3E`

Decoded: `{"temp": 23.5, "humidity": 61.300000000000004, "is_active": true}`
