use serde_json::Value;

use crate::error::AppError;

use super::account::AccountRegistry;

/// Deserialize and migrate an `AccountRegistry` JSON blob to the current schema.
/// Supported migrations:
///   - version 0 → 1: adds `default_account_id` field (defaults to `null`)
///   - version 1: no-op, current schema
///   - unknown version > 1: returns an error rather than silently corrupting data
pub fn migrate_account_registry(data: &str) -> Result<AccountRegistry, AppError> {
    let mut value: Value = serde_json::from_str(data)?;

    let version = value
        .get("schema_version")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;

    match version {
        0 => {
            // v0 → v1: ensure `default_account_id` exists
            if let Some(obj) = value.as_object_mut() {
                obj.entry("default_account_id")
                    .or_insert(Value::Null);
                obj.insert("schema_version".to_string(), Value::from(1u32));
            }
            let registry: AccountRegistry = serde_json::from_value(value)?;
            Ok(registry)
        }
        1 => {
            // Current version — deserialize directly.
            let registry: AccountRegistry = serde_json::from_value(value)?;
            Ok(registry)
        }
        unknown => Err(AppError::Serde(serde::de::Error::custom(format!(
            "Unknown AccountRegistry schema version: {}. \
             Please upgrade GitBaro to read this file.",
            unknown
        )))),
    }
}
