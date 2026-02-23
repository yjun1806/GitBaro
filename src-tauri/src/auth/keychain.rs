use keyring::Entry;
use uuid::Uuid;

use crate::error::AppError;

const SERVICE_NAME: &str = "com.gitease.app";

pub struct KeychainManager;

impl KeychainManager {
    /// Store a token value in the macOS Keychain under the given key.
    pub fn store_token(key: &str, token: &str) -> Result<(), AppError> {
        let entry = Entry::new(SERVICE_NAME, key)
            .map_err(|e| AppError::Keychain(e.to_string()))?;
        entry
            .set_password(token)
            .map_err(|e| AppError::Keychain(e.to_string()))?;
        Ok(())
    }

    /// Retrieve a token value from the macOS Keychain.
    /// Returns `AppError::Keychain` if not found or on any other error.
    pub fn retrieve_token(key: &str) -> Result<String, AppError> {
        let entry = Entry::new(SERVICE_NAME, key)
            .map_err(|e| AppError::Keychain(e.to_string()))?;
        entry
            .get_password()
            .map_err(|e| AppError::Keychain(e.to_string()))
    }

    /// Delete a token from the macOS Keychain.
    /// Treats "not found" as success so callers don't need to pre-check.
    pub fn delete_token(key: &str) -> Result<(), AppError> {
        let entry = Entry::new(SERVICE_NAME, key)
            .map_err(|e| AppError::Keychain(e.to_string()))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()), // already absent — that's fine
            Err(e) => Err(AppError::Keychain(e.to_string())),
        }
    }

    /// Generate a unique, unpredictable Keychain key for an access token.
    pub fn generate_token_ref() -> String {
        format!("gitease-tkn-{}", Uuid::new_v4())
    }

    /// Generate a unique, unpredictable Keychain key for a refresh token.
    pub fn generate_refresh_token_ref() -> String {
        format!("gitease-rtk-{}", Uuid::new_v4())
    }
}
