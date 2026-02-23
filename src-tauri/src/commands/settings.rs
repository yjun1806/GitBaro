use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppSettings {
    pub theme: String,
    pub default_editor: String,
    pub default_shell: String,
    pub auto_fetch_interval: u64,
    pub language: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            theme: "system".to_string(),
            default_editor: "code".to_string(),
            default_shell: "terminal".to_string(),
            auto_fetch_interval: 0,
            language: "en".to_string(),
        }
    }
}

fn settings_path() -> std::path::PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("com.gitbaro.app")
        .join("settings.json")
}

async fn load_settings() -> Result<AppSettings, AppError> {
    let path = settings_path();
    match tokio::fs::read_to_string(&path).await {
        Ok(contents) => {
            let settings: AppSettings = serde_json::from_str(&contents)?;
            Ok(settings)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(AppSettings::default()),
        Err(e) => Err(AppError::Io(e)),
    }
}

async fn save_settings(settings: &AppSettings) -> Result<(), AppError> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let contents = serde_json::to_string_pretty(settings)?;
    tokio::fs::write(&path, contents).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_settings() -> Result<AppSettings, AppError> {
    load_settings().await
}

#[tauri::command]
pub async fn update_settings(settings: AppSettings) -> Result<(), AppError> {
    save_settings(&settings).await?;
    tracing::info!("Settings updated: theme={}", settings.theme);
    Ok(())
}

#[tauri::command]
pub async fn get_theme() -> Result<String, AppError> {
    let settings = load_settings().await?;
    Ok(settings.theme)
}

#[tauri::command]
pub async fn set_theme(theme: String) -> Result<(), AppError> {
    let mut settings = load_settings().await?;
    settings.theme = theme.clone();
    save_settings(&settings).await?;
    tracing::info!("Theme set to: {}", theme);
    Ok(())
}
