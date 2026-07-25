// SPDX-License-Identifier: AGPL-3.0-or-later
use serde_json::Value;

pub fn to_vec(value: &Value) -> Result<Vec<u8>, &'static str> {
    let mut output = Vec::new();
    write_value(value, &mut output)?;
    Ok(output)
}

fn write_value(value: &Value, output: &mut Vec<u8>) -> Result<(), &'static str> {
    match value {
        Value::Null => output.extend_from_slice(b"null"),
        Value::Bool(true) => output.extend_from_slice(b"true"),
        Value::Bool(false) => output.extend_from_slice(b"false"),
        Value::Number(number) => {
            output.extend_from_slice(number.to_string().as_bytes());
        }
        Value::String(text) => {
            let encoded = serde_json::to_string(text)
                .map_err(|_| "string serialization failed")?;
            output.extend_from_slice(encoded.as_bytes());
        }
        Value::Array(values) => {
            output.push(b'[');
            for (index, item) in values.iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                write_value(item, output)?;
            }
            output.push(b']');
        }
        Value::Object(values) => {
            output.push(b'{');
            let mut keys: Vec<&String> = values.keys().collect();
            keys.sort();
            for (index, key) in keys.iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                let encoded_key = serde_json::to_string(key)
                    .map_err(|_| "object key serialization failed")?;
                output.extend_from_slice(encoded_key.as_bytes());
                output.push(b':');
                write_value(
                    values.get(*key).ok_or("object key missing")?,
                    output,
                )?;
            }
            output.push(b'}');
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::to_vec;
    use serde_json::json;

    #[test]
    fn object_keys_are_sorted_recursively() {
        let value = json!({"z":{"y":2,"a":1},"a":0});
        assert_eq!(
            String::from_utf8(to_vec(&value).unwrap()).unwrap(),
            r#"{"a":0,"z":{"a":1,"y":2}}"#
        );
    }

    #[test]
    fn arrays_preserve_order() {
        let value = json!([3, 1, 2]);
        assert_eq!(
            String::from_utf8(to_vec(&value).unwrap()).unwrap(),
            "[3,1,2]"
        );
    }
}
