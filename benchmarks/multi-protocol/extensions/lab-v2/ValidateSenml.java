import java.nio.file.*;
import java.util.*;
import com.fasterxml.jackson.databind.*;
import org.eclipse.leshan.core.model.*;
import org.eclipse.leshan.core.node.*;
import org.eclipse.leshan.core.node.codec.*;
import org.eclipse.leshan.core.request.*;
// Independent decode of calculator-generated SenML with the real Leshan model.
public class ValidateSenml {
 public static void main(String[] args)throws Exception {
  ObjectMapper json=new ObjectMapper();List<Object> results=new ArrayList<>();
  for(JsonNode input:json.readTree(Path.of(args[0]).toFile())){
   List<ResourceModel> resources=new ArrayList<>();Map<Integer,String> names=new HashMap<>();int id=0;
   for(JsonNode f:input.get("fields")){String name=f.get("name").asText();resources.add(BenchmarkLwm2m.resource(id,name,BenchmarkLwm2m.type(f.get("type").asText())));names.put(id++,name);}
   StaticModel model=new StaticModel(BenchmarkLwm2m.model(resources));
   LwM2mObjectInstance decoded=(LwM2mObjectInstance)new DefaultLwM2mDecoder().decode(HexFormat.of().parseHex(input.get("hex").asText()),ContentFormat.fromName(input.get("format").asText()),"/",new LwM2mPath(33000,0),model);
   Map<String,Object> values=new LinkedHashMap<>();
   for(LwM2mResource r:decoded.getResources().values())values.put(names.get(r.getId()),BenchmarkLwm2m.export(r.getValue()));
   JsonNode actual=json.valueToTree(values),expected=input.get("values");
   for(String name:values.keySet()){
    JsonNode a=actual.get(name),e=expected.get(name);
    if(e.isNumber()){if(Math.abs(a.asDouble()-e.asDouble())>Math.max(1,Math.abs(e.asDouble()))*1e-12)throw new AssertionError(input.get("id")+" "+name);}
    else if(!a.equals(e))throw new AssertionError(input.get("id")+" "+name+" "+a+" != "+e);
   }
   if(values.size()!=expected.size())throw new AssertionError("resource count mismatch");
   results.add(Map.of("id",input.get("id").asText(),"implementation","Eclipse Leshan 2.0.0-M18","decoded",values,"payload_hex",input.get("hex").asText(),"test_status","passed"));
  }
  Files.writeString(Path.of(args[1]),json.writerWithDefaultPrettyPrinter().writeValueAsString(results));
  System.out.println("Independent Leshan decode passed: "+results.size());
 }
}
