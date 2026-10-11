"""Parse real DTLS1.2 Hello negotiation and record framing, including RFC9146 CID."""
CIPHERS={0xc0a4:'TLS_PSK_WITH_AES_128_CCM',0xc0a8:'TLS_PSK_WITH_AES_128_CCM_8',0x00a8:'TLS_PSK_WITH_AES_128_GCM_SHA256',0xd001:'TLS_ECDHE_PSK_WITH_AES_128_GCM_SHA256'}

def parameters(events):
    result={'cid_bytes':{'up':0,'down':0},'cipher':None}
    for e in events:
        data=bytes.fromhex(e['hex']);i=0
        while i+13<=len(data):
            typ=data[i]
            if typ==25:break # Ciphertext needs negotiated CID length, decoded below separately.
            n=int.from_bytes(data[i+11:i+13],'big');body=data[i+13:i+13+n];i+=13+n
            if typ!=22:continue
            j=0
            while j+12<=len(body):
                kind=body[j];offset=int.from_bytes(body[j+6:j+9],'big');length=int.from_bytes(body[j+9:j+12],'big')
                hello=body[j+12:j+12+length];j+=12+length
                if kind not in [1,2] or offset or len(hello)<35:continue
                k=35+hello[34]
                if kind==1:
                    cookie=hello[k];k+=1+cookie
                    suites=int.from_bytes(hello[k:k+2],'big');k+=2+suites
                    compression=hello[k];k+=1+compression
                else:
                    cipher=int.from_bytes(hello[k:k+2],'big');result['cipher']=CIPHERS.get(cipher,hex(cipher));k+=3
                if k+2>len(hello):continue
                end=k+2+int.from_bytes(hello[k:k+2],'big');k+=2
                while k+4<=end:
                    extension=int.from_bytes(hello[k:k+2],'big');size=int.from_bytes(hello[k+2:k+4],'big');value=hello[k+4:k+4+size];k+=4+size
                    if extension==54 and value:
                        assert value[0]==len(value)-1
                        # Each Hello advertises the CID its sender wants to RECEIVE.
                        result['cid_bytes']['down' if e['direction']=='up' else 'up']=value[0]
    return result

def records(data,cid_bytes):
    out=[];i=0
    while i<len(data):
        assert len(data)-i>=13,'truncated DTLS header'
        kind=data[i];assert kind in [20,21,22,23,25],kind
        assert data[i+1:i+3] in [b'\xfe\xfd',b'\xfe\xff']
        cid=cid_bytes if kind==25 else 0;header=13+cid
        assert i+header<=len(data)
        size=int.from_bytes(data[i+11+cid:i+13+cid],'big')
        assert i+header+size<=len(data),'DTLS record length exceeds datagram'
        out.append(dict(content_type=kind,header_bytes=header,cid_bytes=cid,encrypted_fragment_bytes=size))
        i+=header+size
    return out
