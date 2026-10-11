import java.io.*;
import java.net.*;
import java.util.*;
import com.fasterxml.jackson.databind.*;
import org.eclipse.californium.core.*;
import org.eclipse.californium.core.coap.*;
import org.eclipse.californium.core.server.resources.*;
import org.eclipse.californium.core.network.*;
import org.eclipse.californium.core.config.*;
import org.eclipse.californium.elements.config.*;
import org.eclipse.californium.scandium.*;
import org.eclipse.californium.scandium.config.*;
import org.eclipse.californium.scandium.dtls.cipher.*;
import org.eclipse.californium.scandium.dtls.pskstore.*;

public class BenchmarkDtls {
 static ObjectMapper json=new ObjectMapper();
 static void output(Object value){try{System.out.println("BENCH:"+json.writeValueAsString(value));System.out.flush();}catch(Exception e){throw new RuntimeException(e);}}
 static CoapEndpoint endpoint(int port,String cipher)throws Exception{
  CoapConfig.register();DtlsConfig.register();Configuration configuration=Configuration.createStandardWithoutFile();
  configuration.set(CoapConfig.PROTOCOL_STAGE_THREAD_COUNT,2);
  DtlsConnectorConfig config=new DtlsConnectorConfig.Builder(configuration).setAddress(new InetSocketAddress("127.0.0.1",port))
   .setPskStore(new SinglePskStore("local-benchmark",HexFormat.of().parseHex("00112233445566778899aabbccddeeff")))
   .setAsList(DtlsConfig.DTLS_CIPHER_SUITES,CipherSuite.valueOf(cipher)).build();
  return new CoapEndpoint.Builder().setConfiguration(configuration).setConnector(new DTLSConnector(config)).build();
 }
 public static void main(String[]args)throws Exception{
  String mode=args[0];CoapEndpoint ep=endpoint(Integer.parseInt(args[1]),args[2]);
  if(mode.equals("server")){
   CoapServer server=new CoapServer();server.addEndpoint(ep);server.add(new CoapResource("t"){
    @Override public void handlePOST(CoapExchange exchange){byte[] payload=exchange.getRequestPayload();output(Map.of("received_hex",HexFormat.of().formatHex(payload)));exchange.respond(CoAP.ResponseCode.CHANGED,payload);}
   });
   server.start();output(Map.of("ready",true));try{new BufferedReader(new InputStreamReader(System.in)).readLine();}finally{server.destroy();}
  }else{
   ep.start();CoapClient client=new CoapClient(args[3]).setEndpoint(ep).setTimeout(5000L);output(Map.of("ready",true));
   BufferedReader in=new BufferedReader(new InputStreamReader(System.in));String line;
   try{while((line=in.readLine())!=null&&!line.equals("quit")){
    JsonNode command=json.readTree(line);Request request=new Request(CoAP.Code.POST,command.get("con").asBoolean()?CoAP.Type.CON:CoAP.Type.NON);
    request.setURI(args[3]);request.setPayload(HexFormat.of().parseHex(command.get("hex").asText()));request.getOptions().setContentFormat(command.get("format").asInt());
    long start=System.nanoTime();CoapResponse response=client.advanced(request);
    output(response==null?Map.of("error","no response"):Map.of("hex",HexFormat.of().formatHex(response.getPayload()),"code",response.getCode().toString(),"latency_ns",System.nanoTime()-start));
   }}finally{client.shutdown();ep.destroy();}
  }
 }
}
