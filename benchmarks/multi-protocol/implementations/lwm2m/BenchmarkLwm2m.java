import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;
import com.fasterxml.jackson.databind.*;
import org.eclipse.leshan.core.model.*;
import org.eclipse.leshan.core.node.*;
import org.eclipse.leshan.core.node.codec.*;
import org.eclipse.leshan.core.request.*;
import org.eclipse.leshan.core.util.datatype.ULong;
import org.eclipse.leshan.client.*;
import org.eclipse.leshan.client.object.*;
import org.eclipse.leshan.client.resource.*;
import org.eclipse.leshan.transport.californium.client.endpoint.*;
import org.eclipse.leshan.transport.californium.client.endpoint.coap.*;
import org.eclipse.leshan.transport.californium.client.endpoint.coaps.*;

public class BenchmarkLwm2m {
 static final ObjectMapper JSON=new ObjectMapper();
 static ResourceModel resource(int id,String name,ResourceModel.Type type){return new ResourceModel(id,name,ResourceModel.Operations.RW,false,false,type,null,null,"Local benchmark");}
 static ObjectModel model(List<ResourceModel> resources){return new ObjectModel(33000,"LocalBenchmark","Not a standardized object","1.0",false,false,resources);}
 static ResourceModel.Type type(String t){
  if(t.equals("bool"))return ResourceModel.Type.BOOLEAN;
  if(t.startsWith("float"))return ResourceModel.Type.FLOAT;
  if(t.equals("string"))return ResourceModel.Type.STRING;
  if(t.equals("bytes"))return ResourceModel.Type.OPAQUE;
  if(t.startsWith("uint")||t.equals("fixed")||t.equals("enum")||t.equals("bitset")||t.equals("timestamp"))return ResourceModel.Type.UNSIGNED_INTEGER;
  if(t.startsWith("int")||t.equals("sintvar"))return ResourceModel.Type.INTEGER;
  throw new UnsupportedOperationException("No flat LwM2M resource mapping for "+t);
 }
 static Object value(JsonNode node,ResourceModel.Type type){
  if(node.has("$integer"))node=JSON.getNodeFactory().numberNode(new java.math.BigInteger(node.get("$integer").asText()));
  switch(type){
   case BOOLEAN:return node.asBoolean();case FLOAT:return node.asDouble();case STRING:return node.asText();
   case OPAQUE:return HexFormat.of().parseHex(node.get("$bytes").asText());
   case UNSIGNED_INTEGER:return ULong.valueOf(node.asText());
   default:return node.asLong();
  }
 }
 static Object export(Object v){
  if(v instanceof byte[])return Map.of("$bytes",HexFormat.of().formatHex((byte[])v));
  if(v instanceof ULong)return ((ULong)v).toBigInteger();return v;
 }
 static void codecs(String input,String output)throws Exception{
  DefaultLwM2mEncoder encoder=new DefaultLwM2mEncoder();DefaultLwM2mDecoder decoder=new DefaultLwM2mDecoder();
  try(BufferedWriter out=Files.newBufferedWriter(Path.of(output))){
   for(JsonNode c:JSON.readTree(Path.of(input).toFile())){
    for(ContentFormat format:List.of(ContentFormat.TLV,ContentFormat.JSON,ContentFormat.SENML_JSON,ContentFormat.SENML_CBOR,ContentFormat.TEXT,ContentFormat.OPAQUE)){
     Map<String,Object> result=new LinkedHashMap<>();result.put("schema_id",c.get("id").asText());result.put("format",format.getName());result.put("content_format",format.getCode());
     try{
      List<ResourceModel> resources=new ArrayList<>();List<LwM2mResource> nodes=new ArrayList<>();Map<Integer,String> names=new LinkedHashMap<>();int id=0;
      for(JsonNode f:c.get("fields")){
       if(f.path("repeated").asBoolean())throw new UnsupportedOperationException("Repeated-resource adapter not implemented");
       String name=f.get("name").asText();ResourceModel.Type t=type(f.get("type").asText());resources.add(resource(id,name,t));names.put(id,name);
       if(c.get("transformed_values").has(name))nodes.add(LwM2mSingleResource.newResource(id,value(c.get("transformed_values").get(name),t),t));id++;
      }
      StaticModel m=new StaticModel(model(resources));LwM2mNode node=new LwM2mObjectInstance(0,nodes);LwM2mPath path=new LwM2mPath(33000,0);
      if(format.equals(ContentFormat.TEXT)||format.equals(ContentFormat.OPAQUE)){
       if(nodes.size()!=1)throw new UnsupportedOperationException("Text/opaque only single-resource telemetry");
       node=nodes.get(0);path=new LwM2mPath(33000,0,node instanceof LwM2mResource?((LwM2mResource)node).getId():0);
       if(format.equals(ContentFormat.OPAQUE)&&((LwM2mResource)node).getType()!=ResourceModel.Type.OPAQUE)throw new UnsupportedOperationException("Opaque requires byte resource");
      }
      byte[] bytes=encoder.encode(node,format,"/",path,m);LwM2mNode decoded=decoder.decode(bytes,format,"/",path,m);
      Map<String,Object> values=new LinkedHashMap<>();
      if(decoded instanceof LwM2mObjectInstance)for(LwM2mResource r:((LwM2mObjectInstance)decoded).getResources().values())values.put(names.get(r.getId()),export(r.getValue()));
      else{LwM2mResource r=(LwM2mResource)decoded;values.put(names.get(r.getId()),export(r.getValue()));}
      result.put("decoded",values);result.put("hex",HexFormat.of().formatHex(bytes));result.put("bytes",bytes.length);result.put("status","passed");
      long[] encodeNs=new long[100],decodeNs=new long[100];
      for(int i=-20;i<100;i++){
       long start=System.nanoTime();encoder.encode(node,format,"/",path,m);long a=System.nanoTime()-start;
       start=System.nanoTime();decoder.decode(bytes,format,"/",path,m);long b=System.nanoTime()-start;
       if(i>=0){encodeNs[i]=a;decodeNs[i]=b;}
      }
      result.put("encode_ns",encodeNs);result.put("decode_ns",decodeNs);
     }catch(UnsupportedOperationException|CodecException e){result.put("status","unsupported");result.put("reason",e.toString());}
     catch(Exception e){result.put("status","failed");result.put("reason",e.toString());}
     out.write(JSON.writeValueAsString(result));out.newLine();out.flush();
    }
   }
  }
 }
 public static class Sensor extends SimpleInstanceEnabler {
  public Sensor(){super(0,Map.of(0,23.5,1,61.25,2,true));}
  public void notifyValues(){fireResourcesChange(new LwM2mPath(33000,0,0),new LwM2mPath(33000,0,1),new LwM2mPath(33000,0,2));}
 }
 static void client(String[] args)throws Exception{
  String uri=args[1],endpoint=args[2];boolean secure=uri.startsWith("coaps:");
  List<ObjectModel> models=new ArrayList<>(ObjectLoader.loadDefault());
  models.add(model(List.of(resource(0,"temp",ResourceModel.Type.FLOAT),resource(1,"humidity",ResourceModel.Type.FLOAT),resource(2,"is_active",ResourceModel.Type.BOOLEAN))));
  ObjectsInitializer init=new ObjectsInitializer(new StaticModel(models));
  init.setInstancesForObject(0,secure?Security.psk(uri,123,"benchmark-psk".getBytes(java.nio.charset.StandardCharsets.US_ASCII),HexFormat.of().parseHex("00112233445566778899aabbccddeeff")):Security.noSec(uri,123));
  init.setInstancesForObject(1,new Server(123,60));init.setInstancesForObject(3,new Device("Struct benchmark","host","local"));
  Sensor sensor=new Sensor();init.setInstancesForObject(33000,sensor);
  LeshanClient client=new LeshanClientBuilder(endpoint).setObjects(init.create(0,1,3,33000)).setDataSenders(new org.eclipse.leshan.client.send.ManualDataSender())
   .setEndpointsProviders(new CaliforniumClientEndpointsProvider.Builder(new CoapClientProtocolProvider(),new CoapsClientProtocolProvider()).setClientAddress(InetAddress.getByName("127.0.0.1")).build()).build();
  try{client.start();System.out.println("BENCHMARK_CLIENT_STARTED");
   BufferedReader in=new BufferedReader(new InputStreamReader(System.in));String line;
   while((line=in.readLine())!=null){
    if(line.equals("update"))client.triggerRegistrationUpdate();else if(line.equals("notify"))sensor.notifyValues();
    else if(line.startsWith("send ")){
     var server=client.getRegisteredServers().values().iterator().next();
     var response=client.getSendService().sendData(server,ContentFormat.fromName(line.substring(5)),List.of("/33000/0"),5000);
     System.out.println("BENCHMARK_SEND_RESULT:"+response.toString());System.out.flush();
    }else if(line.equals("quit"))break;
   }
  }finally{client.destroy(true);}
 }
 public static void main(String[]args)throws Exception{if(args[0].equals("codecs"))codecs(args[1],args[2]);else client(args);}
}
