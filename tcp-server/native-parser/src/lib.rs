#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Debug, Deserialize)]
struct FlagBit {
  name: String,
  bit: u8,
}

#[derive(Debug, Deserialize)]
struct SchemaField {
  name: String,
  #[serde(rename = "type")]
  field_type: String,
  #[serde(default)]
  bits: Option<Vec<FlagBit>>,
}

fn parse_schema(schema_json: &str) -> Result<Vec<SchemaField>> {
  serde_json::from_str(schema_json).map_err(|e| {
    Error::from_reason(format!("Invalid schema JSON: {e}"))
  })
}

fn validate_flags(field: &SchemaField) -> Result<()> {
  let bits = field.bits.as_ref().ok_or_else(|| {
    Error::from_reason(format!(
      "flags field \"{}\" requires a non-empty bits array",
      field.name
    ))
  })?;
  if bits.is_empty() {
    return Err(Error::from_reason(format!(
      "flags field \"{}\" requires a non-empty bits array",
      field.name
    )));
  }
  let mut seen = HashSet::new();
  for bit in bits {
    if bit.name.is_empty() {
      return Err(Error::from_reason(format!(
        "flags field \"{}\" has an invalid bit name",
        field.name
      )));
    }
    if bit.bit > 7 {
      return Err(Error::from_reason(format!(
        "flags field \"{}\" bit \"{}\" must be 0..7",
        field.name, bit.name
      )));
    }
    if !seen.insert(bit.bit) {
      return Err(Error::from_reason(format!(
        "flags field \"{}\" has duplicate bit position {}",
        field.name, bit.bit
      )));
    }
  }
  Ok(())
}

fn field_size(field: &SchemaField) -> Result<usize> {
  match field.field_type.to_ascii_lowercase().as_str() {
    "float32" | "int32" => Ok(4),
    "uint8" | "boolean" => Ok(1),
    "flags" => {
      validate_flags(field)?;
      Ok(1)
    }
    other => Err(Error::from_reason(format!("Unsupported schema type: {other}"))),
  }
}

fn schema_len(schema: &[SchemaField]) -> Result<usize> {
  let mut total = 0usize;
  for field in schema {
    total = total
      .checked_add(field_size(field)?)
      .ok_or_else(|| Error::from_reason("schema too large"))?;
  }
  Ok(total)
}

fn read_f32_le(buf: &[u8], offset: usize) -> f32 {
  f32::from_le_bytes(buf[offset..offset + 4].try_into().unwrap())
}

fn read_i32_le(buf: &[u8], offset: usize) -> i32 {
  i32::from_le_bytes(buf[offset..offset + 4].try_into().unwrap())
}

fn write_f32_le(buf: &mut [u8], offset: usize, v: f32) {
  buf[offset..offset + 4].copy_from_slice(&v.to_le_bytes());
}

fn write_i32_le(buf: &mut [u8], offset: usize, v: i32) {
  buf[offset..offset + 4].copy_from_slice(&v.to_le_bytes());
}

#[napi]
pub fn schema_byte_length(schema_json: String) -> Result<u32> {
  let schema = parse_schema(&schema_json)?;
  Ok(schema_len(&schema)? as u32)
}

#[napi]
pub fn parse_payload(payload: Buffer, schema_json: String) -> Result<Value> {
  let schema = parse_schema(&schema_json)?;
  let buf = payload.as_ref();
  let mut out = serde_json::Map::new();
  let mut offset = 0usize;

  for field in &schema {
    let size = field_size(field)?;
    if offset + size > buf.len() {
      return Err(Error::from_reason(format!(
        "Unaligned / truncated payload at field \"{}\" (offset {}, need {}, have {})",
        field.name,
        offset,
        size,
        buf.len()
      )));
    }

    match field.field_type.to_ascii_lowercase().as_str() {
      "float32" => {
        out.insert(field.name.clone(), json!(read_f32_le(buf, offset) as f64));
      }
      "int32" => {
        out.insert(field.name.clone(), json!(read_i32_le(buf, offset)));
      }
      "uint8" => {
        out.insert(field.name.clone(), json!(buf[offset] as u32));
      }
      "boolean" => {
        out.insert(field.name.clone(), json!(buf[offset] != 0));
      }
      "flags" => {
        let byte = buf[offset];
        let mut flags = serde_json::Map::new();
        for bit in field.bits.as_ref().unwrap() {
          flags.insert(
            bit.name.clone(),
            json!(((byte >> bit.bit) & 1) == 1),
          );
        }
        out.insert(field.name.clone(), Value::Object(flags));
      }
      other => {
        return Err(Error::from_reason(format!("Unhandled type \"{other}\"")));
      }
    }

    offset += size;
  }

  Ok(Value::Object(out))
}

#[napi]
pub fn encode_payload(values_json: String, schema_json: String) -> Result<Buffer> {
  let schema = parse_schema(&schema_json)?;
  let values: Value = serde_json::from_str(&values_json).map_err(|e| {
    Error::from_reason(format!("Invalid values JSON: {e}"))
  })?;
  let values = values
    .as_object()
    .ok_or_else(|| Error::from_reason("values must be a JSON object"))?;

  let len = schema_len(&schema)?;
  let mut buf = vec![0u8; len];
  let mut offset = 0usize;

  for field in &schema {
    let size = field_size(field)?;
    let v = values.get(&field.name);

    match field.field_type.to_ascii_lowercase().as_str() {
      "float32" => {
        let n = v.and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
        write_f32_le(&mut buf, offset, n);
      }
      "int32" => {
        let n = v.and_then(|x| x.as_i64()).unwrap_or(0) as i32;
        write_i32_le(&mut buf, offset, n);
      }
      "uint8" => {
        let n = v.and_then(|x| x.as_u64()).unwrap_or(0) as u8;
        buf[offset] = n;
      }
      "boolean" => {
        let flag = v.map(|x| x.as_bool().unwrap_or(x.as_f64().unwrap_or(0.0) != 0.0)).unwrap_or(false);
        buf[offset] = if flag { 1 } else { 0 };
      }
      "flags" => {
        let mut byte = 0u8;
        let source = v.and_then(|x| x.as_object());
        for bit in field.bits.as_ref().unwrap() {
          let on = source
            .and_then(|m| m.get(&bit.name))
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
          if on {
            byte |= 1u8 << bit.bit;
          }
        }
        buf[offset] = byte;
      }
      other => {
        return Err(Error::from_reason(format!("Unhandled type \"{other}\"")));
      }
    }

    offset += size;
  }

  Ok(Buffer::from(buf))
}
