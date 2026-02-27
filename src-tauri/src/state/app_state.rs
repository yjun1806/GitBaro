use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::{info, warn};

use crate::error::AppError;

const APP_DATA_DIR: &str = "com.gitbaro.app";
const STATE_FILE: &str = "app-state.json";

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AppState {
    pub open_repos: Vec<String>,
    pub last_active_repo: Option<String>,
    pub window_bounds: Option<WindowBounds>,
    pub sidebar_width: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WindowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub maximized: bool,
}

const DEFAULT_WIDTH: f64 = 1400.0;
const DEFAULT_HEIGHT: f64 = 860.0;
const MIN_WIDTH: f64 = 1024.0;
const MIN_HEIGHT: f64 = 680.0;

impl WindowBounds {
    /// 저장된 bounds가 유효한지 검증하고, 유효하지 않으면 기본값으로 보정한다.
    /// - width/height가 최소값 미만이면 기본값 사용
    /// - x/y가 극단적 음수(-10000 이하)이면 기본값 사용 (모니터 제거 시나리오)
    pub fn validated(self) -> Self {
        let (width, height) = if self.width < MIN_WIDTH || self.height < MIN_HEIGHT {
            info!(
                "Window bounds too small ({}x{}), using defaults",
                self.width, self.height
            );
            (DEFAULT_WIDTH, DEFAULT_HEIGHT)
        } else {
            (self.width, self.height)
        };

        let (x, y) = if self.x < -10000.0 || self.y < -10000.0 {
            info!(
                "Window position out of range ({}, {}), centering",
                self.x, self.y
            );
            (100.0, 100.0)
        } else {
            (self.x, self.y)
        };

        Self {
            x,
            y,
            width,
            height,
            maximized: self.maximized,
        }
    }
}

/// Returns the application data directory (`~/Library/Application Support/com.gitbaro.app`),
/// creating it if it does not exist.
pub fn get_state_dir() -> PathBuf {
    let base = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("~/.local/share"));
    let dir = base.join(APP_DATA_DIR);

    if !dir.exists() {
        if let Err(e) = std::fs::create_dir_all(&dir) {
            warn!("Failed to create state directory {:?}: {}", dir, e);
        }
    }

    dir
}

/// Load `AppState` from disk.  Falls back to `AppState::default()` if the
/// file is absent or cannot be parsed, so the app always has a usable state.
pub async fn load_app_state(_app_handle: &tauri::AppHandle) -> AppState {
    let path = get_state_dir().join(STATE_FILE);

    if !path.exists() {
        info!("No app-state.json found — using defaults");
        return AppState::default();
    }

    match std::fs::read_to_string(&path) {
        Err(e) => {
            warn!("Could not read app-state.json: {} — using defaults", e);
            AppState::default()
        }
        Ok(raw) => match serde_json::from_str::<AppState>(&raw) {
            Ok(state) => state,
            Err(e) => {
                warn!("Could not parse app-state.json: {} — using defaults", e);
                AppState::default()
            }
        },
    }
}

/// Persist `AppState` to `~/Library/Application Support/com.gitbaro.app/app-state.json`.
pub async fn save_app_state(state: &AppState) -> Result<(), AppError> {
    let dir = get_state_dir();
    std::fs::create_dir_all(&dir)?;

    let path = dir.join(STATE_FILE);
    let json = serde_json::to_string_pretty(state)?;
    std::fs::write(&path, json)?;
    Ok(())
}
