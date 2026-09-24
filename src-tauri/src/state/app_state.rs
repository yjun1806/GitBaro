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

/// A monitor's area in logical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScreenRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// How much of the window must be on a screen for it to count as reachable —
/// enough to grab the title bar.
const MIN_VISIBLE: f64 = 50.0;

impl WindowBounds {
    /// Whether enough of the window lies on one of `screens` to be reached
    /// with the mouse. False after the monitor it was on has been unplugged.
    pub fn is_visible_on(&self, screens: &[ScreenRect]) -> bool {
        screens.iter().any(|s| {
            let overlap_w = (self.x + self.width).min(s.x + s.width) - self.x.max(s.x);
            let overlap_h = (self.y + self.height).min(s.y + s.height) - self.y.max(s.y);
            overlap_w >= MIN_VISIBLE && overlap_h >= MIN_VISIBLE
        })
    }

    /// The same window centered on `screen`, shrunk to fit if it is larger.
    pub fn centered_on(&self, screen: &ScreenRect) -> Self {
        let width = self.width.min(screen.width);
        let height = self.height.min(screen.height);
        Self {
            x: screen.x + (screen.width - width) / 2.0,
            y: screen.y + (screen.height - height) / 2.0,
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

#[cfg(test)]
mod tests {
    use super::*;

    const MAIN: ScreenRect = ScreenRect { x: 0.0, y: 0.0, width: 1728.0, height: 1117.0 };
    const RIGHT: ScreenRect = ScreenRect { x: 1728.0, y: 0.0, width: 2560.0, height: 1440.0 };

    fn bounds(x: f64, y: f64) -> WindowBounds {
        WindowBounds { x, y, width: 1400.0, height: 860.0, maximized: false }
    }

    #[test]
    fn a_window_on_a_connected_monitor_is_visible() {
        assert!(bounds(100.0, 50.0).is_visible_on(&[MAIN]));
        assert!(bounds(2000.0, 100.0).is_visible_on(&[MAIN, RIGHT]));
    }

    /// 외부 모니터를 뺀 뒤 그 모니터 좌표에 저장된 창은 보이지 않는다.
    #[test]
    fn a_window_left_on_an_unplugged_monitor_is_not_visible() {
        assert!(!bounds(2000.0, 100.0).is_visible_on(&[MAIN]));
        assert!(!bounds(-3000.0, 200.0).is_visible_on(&[MAIN]));
    }

    #[test]
    fn a_sliver_on_screen_does_not_count_as_visible() {
        // Only 20px of the window pokes onto the main screen.
        assert!(!bounds(MAIN.width - 20.0, 100.0).is_visible_on(&[MAIN]));
    }

    #[test]
    fn centering_places_the_window_in_the_middle_of_the_screen() {
        let centered = bounds(5000.0, 5000.0).centered_on(&RIGHT);
        assert_eq!(centered.x, RIGHT.x + (RIGHT.width - 1400.0) / 2.0);
        assert_eq!(centered.y, (RIGHT.height - 860.0) / 2.0);
        assert!(centered.is_visible_on(&[RIGHT]));
    }

    #[test]
    fn centering_shrinks_a_window_larger_than_the_screen() {
        let small = ScreenRect { x: 0.0, y: 0.0, width: 1280.0, height: 800.0 };
        let centered = bounds(0.0, 0.0).centered_on(&small);
        assert_eq!((centered.x, centered.y), (0.0, 0.0));
        assert_eq!((centered.width, centered.height), (1280.0, 800.0));
    }
}
