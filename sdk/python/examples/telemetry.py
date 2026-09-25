import os
from struct_device import StructClient

client = StructClient(os.environ['STRUCT_HOST'], os.environ['STRUCT_KEY_ID'], os.environ['STRUCT_API_SECRET'],
                      int(os.getenv('STRUCT_PORT', '8081')), encryption_key=os.getenv('STRUCT_ENCRYPTION_KEY'))
result = client.send(1, bytes([42]), confirmed=True)
print(result['status'])
if result['status'] != 'committed':
    raise SystemExit(1)
