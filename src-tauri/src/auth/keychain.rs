use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::RngCore;
use uuid::Uuid;

use crate::error::AppError;

const APP_ID: &str = "com.gitbaro.app";
const TOKENS_FILE: &str = "tokens.json";
const KEY_FILE: &str = "encryption.key";
const ENCRYPTION_KEY_LEN: usize = 32;

pub struct KeychainManager;

impl KeychainManager {
    /// App data directory: ~/Library/Application Support/com.gitbaro.app/
    fn data_dir() -> Result<PathBuf, AppError> {
        let base = dirs::data_dir().ok_or_else(|| {
            AppError::Keychain("Cannot resolve application data directory".into())
        })?;
        Ok(base.join(APP_ID))
    }

    /// Ensure the data directory exists and return its path.
    fn ensure_dir() -> Result<PathBuf, AppError> {
        let dir = Self::data_dir()?;
        if !dir.exists() {
            fs::create_dir_all(&dir)?;
        }
        Ok(dir)
    }

    /// Load or create the 32-byte encryption key.
    fn encryption_key() -> Result<Vec<u8>, AppError> {
        let dir = Self::ensure_dir()?;
        let key_path = dir.join(KEY_FILE);

        if key_path.exists() {
            let key = fs::read(&key_path)?;
            if key.len() == ENCRYPTION_KEY_LEN {
                return Ok(key);
            }
        }

        let mut key = vec![0u8; ENCRYPTION_KEY_LEN];
        rand::thread_rng().fill_bytes(&mut key);
        fs::write(&key_path, &key)?;
        Ok(key)
    }

    /// XOR cipher — symmetric, so encrypt and decrypt are the same operation.
    fn xor_cipher(data: &[u8], key: &[u8]) -> Vec<u8> {
        data.iter()
            .enumerate()
            .map(|(i, b)| b ^ key[i % key.len()])
            .collect()
    }

    /// Encrypt a plaintext token and return a base64-encoded string.
    fn encrypt(plaintext: &str) -> Result<String, AppError> {
        let key = Self::encryption_key()?;
        let encrypted = Self::xor_cipher(plaintext.as_bytes(), &key);
        Ok(BASE64.encode(encrypted))
    }

    /// Decrypt a base64-encoded ciphertext back to a token string.
    fn decrypt(ciphertext: &str) -> Result<String, AppError> {
        let key = Self::encryption_key()?;
        let encrypted = BASE64
            .decode(ciphertext)
            .map_err(|e| AppError::Keychain(format!("Base64 decode error: {}", e)))?;
        let decrypted = Self::xor_cipher(&encrypted, &key);
        String::from_utf8(decrypted)
            .map_err(|e| AppError::Keychain(format!("UTF-8 decode error: {}", e)))
    }

    /// Load the token map from tokens.json.
    fn load_tokens() -> Result<HashMap<String, String>, AppError> {
        let dir = Self::ensure_dir()?;
        let path = dir.join(TOKENS_FILE);

        if !path.exists() {
            return Ok(HashMap::new());
        }

        let content = fs::read_to_string(&path)?;
        let tokens: HashMap<String, String> = serde_json::from_str(&content)?;
        Ok(tokens)
    }

    /// Persist the token map to tokens.json.
    fn save_tokens(tokens: &HashMap<String, String>) -> Result<(), AppError> {
        let dir = Self::ensure_dir()?;
        let path = dir.join(TOKENS_FILE);
        let content = serde_json::to_string_pretty(tokens)?;
        fs::write(&path, content)?;
        Ok(())
    }

    /// Store a token value under the given key (encrypted).
    pub fn store_token(key: &str, token: &str) -> Result<(), AppError> {
        let encrypted = Self::encrypt(token)?;
        let mut tokens = Self::load_tokens()?;
        tokens.insert(key.to_string(), encrypted);
        Self::save_tokens(&tokens)
    }

    /// Retrieve a token value by key (decrypted).
    /// Falls back to legacy macOS Keychain and auto-migrates if found.
    pub fn retrieve_token(key: &str) -> Result<String, AppError> {
        let tokens = Self::load_tokens()?;
        if let Some(encrypted) = tokens.get(key) {
            return Self::decrypt(encrypted);
        }

        // Fallback: try migrating from legacy macOS Keychain
        if let Some(token) = Self::migrate_from_keychain(key) {
            return Ok(token);
        }

        Err(AppError::Keychain(format!("Token not found: {}", key)))
    }

    /// Try to read a token from the legacy macOS Keychain.
    /// On success, stores it in file-based storage and deletes the Keychain entry.
    fn migrate_from_keychain(key: &str) -> Option<String> {
        let entry = keyring::Entry::new(APP_ID, key).ok()?;
        let token = entry.get_password().ok()?;

        if Self::store_token(key, &token).is_ok() {
            tracing::info!("Migrated token '{}' from Keychain to file storage", key);
            let _ = entry.delete_credential();
        }

        Some(token)
    }

    /// Delete a token by key.
    /// Treats "not found" as success so callers don't need to pre-check.
    pub fn delete_token(key: &str) -> Result<(), AppError> {
        let mut tokens = Self::load_tokens()?;
        tokens.remove(key);
        Self::save_tokens(&tokens)
    }

    /// Generate a unique, unpredictable key for an access token.
    pub fn generate_token_ref() -> String {
        format!("gitbaro-tkn-{}", Uuid::new_v4())
    }

    /// Generate a unique, unpredictable key for a refresh token.
    pub fn generate_refresh_token_ref() -> String {
        format!("gitbaro-rtk-{}", Uuid::new_v4())
    }
}
