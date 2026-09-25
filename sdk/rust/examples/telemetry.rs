use struct_device::{Client,Delivery,Status};
fn main()->Result<(),Box<dyn std::error::Error>>{
 let endpoint=format!("{}:{}",std::env::var("STRUCT_HOST")?,std::env::var("STRUCT_PORT").unwrap_or("8081".into())).parse()?;
 let mut client=Client::new(endpoint,&std::env::var("STRUCT_KEY_ID")?,&std::env::var("STRUCT_API_SECRET")?)?;
 if let Ok(key)=std::env::var("STRUCT_ENCRYPTION_KEY"){client.set_encryption_hex(&key)?}
 let result=client.send(1,&[42],Delivery{confirmed:true,..Delivery::default()},None)?;
 println!("{:?}",result.status);if result.status!=Status::Committed{return Err("Delivery unconfirmed".into())}Ok(())
}
