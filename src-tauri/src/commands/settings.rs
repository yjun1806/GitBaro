use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    pub default_editor: String,
    pub default_shell: String,
    pub auto_fetch_interval: u64,
    pub language: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct EditorInfo {
    pub id: String,
    pub name: String,
    pub command: String,
    pub installed: bool,
    /// base64-encoded PNG app icon (data URI)
    pub icon: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            theme: "system".to_string(),
            default_editor: "vscode".to_string(),
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

/// 에디터 ID에서 macOS 앱 이름을 조회합니다.
fn editor_app_name(editor_id: &str) -> Option<&'static str> {
    match editor_id {
        "vscode" => Some("Visual Studio Code"),
        "cursor" => Some("Cursor"),
        "antigravity" => Some("Antigravity"),
        "kiro" => Some("Kiro"),
        "zed" => Some("Zed"),
        "sublime" => Some("Sublime Text"),
        "webstorm" => Some("WebStorm"),
        "intellij" => Some("IntelliJ IDEA"),
        "fleet" => Some("Fleet"),
        "xcode" => Some("Xcode"),
        "nova" => Some("Nova"),
        "textmate" => Some("TextMate"),
        "android_studio" => Some("Android Studio"),
        "phpstorm" => Some("PhpStorm"),
        "rubymine" => Some("RubyMine"),
        "goland" => Some("GoLand"),
        "rider" => Some("Rider"),
        _ => None,
    }
}

/// 설정된 기본 편집기로 파일을 엽니다.
/// macOS `open -a` 명령을 사용하여 PATH 의존 없이 앱을 실행합니다.
#[tauri::command]
pub async fn open_in_editor(repo_path: String, file_path: String) -> Result<(), AppError> {
    let settings = load_settings().await?;
    let editor_id = settings.default_editor;

    if editor_id.is_empty() {
        return Err(AppError::Auth("No default editor configured".to_string()));
    }

    let app_name = editor_app_name(&editor_id).ok_or_else(|| {
        AppError::Auth(format!("Unknown editor: {}", editor_id))
    })?;

    let full_path = std::path::Path::new(&repo_path).join(&file_path);

    tokio::process::Command::new("open")
        .args(["-a", app_name])
        .arg(&full_path)
        .spawn()
        .map_err(AppError::Io)?;

    Ok(())
}

/// .app 번들에서 아이콘 파일명을 읽고, sips로 64x64 PNG 변환 후 base64 data URI를 반환합니다.
async fn extract_app_icon(app_bundle: &str) -> Option<String> {
    let app_path = format!("/Applications/{}", app_bundle);
    let plist_path = format!("{}/Contents/Info.plist", app_path);

    // Info.plist에서 CFBundleIconFile 읽기
    let output = tokio::process::Command::new("defaults")
        .args(["read", &plist_path, "CFBundleIconFile"])
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let icon_name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let icon_file = if icon_name.ends_with(".icns") {
        icon_name
    } else {
        format!("{}.icns", icon_name)
    };
    let icns_path = format!("{}/Contents/Resources/{}", app_path, icon_file);

    // sips로 icns → 64x64 PNG 변환
    let tmp_path = format!("/tmp/gitbaro_icon_{}.png", std::process::id());
    let sips_ok = tokio::process::Command::new("sips")
        .args([
            "-s", "format", "png",
            &icns_path,
            "--out", &tmp_path,
            "--resampleHeightWidth", "64", "64",
        ])
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !sips_ok {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return None;
    }

    // PNG 파일을 읽어서 base64 인코딩
    let png_bytes = tokio::fs::read(&tmp_path).await.ok()?;
    let _ = tokio::fs::remove_file(&tmp_path).await;

    use std::io::Write;
    let mut base64_str = String::new();
    {
        let mut encoder = Base64Encoder::new(&mut base64_str);
        encoder.write_all(&png_bytes).ok()?;
    }

    Some(format!("data:image/png;base64,{}", base64_str))
}

/// 간단한 base64 인코더 (외부 크레이트 불필요)
struct Base64Encoder<'a> {
    output: &'a mut String,
    buf: [u8; 3],
    buf_len: usize,
}

const BASE64_CHARS: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

impl<'a> Base64Encoder<'a> {
    fn new(output: &'a mut String) -> Self {
        Self {
            output,
            buf: [0; 3],
            buf_len: 0,
        }
    }

    fn flush_buf(&mut self) {
        if self.buf_len == 0 {
            return;
        }
        let b = self.buf;
        let len = self.buf_len;

        self.output.push(BASE64_CHARS[(b[0] >> 2) as usize] as char);
        self.output
            .push(BASE64_CHARS[((b[0] & 0x03) << 4 | b[1] >> 4) as usize] as char);

        if len > 1 {
            self.output
                .push(BASE64_CHARS[((b[1] & 0x0f) << 2 | b[2] >> 6) as usize] as char);
        } else {
            self.output.push('=');
        }

        if len > 2 {
            self.output.push(BASE64_CHARS[(b[2] & 0x3f) as usize] as char);
        } else {
            self.output.push('=');
        }

        self.buf = [0; 3];
        self.buf_len = 0;
    }
}

impl<'a> std::io::Write for Base64Encoder<'a> {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        for &byte in data {
            self.buf[self.buf_len] = byte;
            self.buf_len += 1;
            if self.buf_len == 3 {
                self.flush_buf();
            }
        }
        Ok(data.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.flush_buf();
        Ok(())
    }
}

impl<'a> Drop for Base64Encoder<'a> {
    fn drop(&mut self) {
        self.flush_buf();
    }
}

/// Finder에서 해당 경로를 선택 상태로 표시합니다.
#[tauri::command]
pub async fn reveal_in_finder(path: String) -> Result<(), AppError> {
    tokio::process::Command::new("open")
        .args(["-R", &path])
        .spawn()
        .map_err(AppError::Io)?;
    Ok(())
}

/// 터미널 ID에서 macOS 앱 이름을 조회합니다.
fn terminal_app_name(shell_id: &str) -> Option<&'static str> {
    match shell_id {
        "terminal" => Some("Terminal"),
        "iterm" => Some("iTerm"),
        "warp" => Some("Warp"),
        "ghostty" => Some("Ghostty"),
        "alacritty" => Some("Alacritty"),
        _ => None,
    }
}

/// 설정된 기본 터미널로 저장소 경로를 엽니다.
#[tauri::command]
pub async fn open_in_terminal(repo_path: String) -> Result<(), AppError> {
    let settings = load_settings().await?;
    let app_name = terminal_app_name(&settings.default_shell).unwrap_or("Terminal");
    tokio::process::Command::new("open")
        .args(["-a", app_name, &repo_path])
        .spawn()
        .map_err(AppError::Io)?;
    Ok(())
}

/// 설정된 기본 편집기로 저장소를 엽니다.
#[tauri::command]
pub async fn open_repo_in_editor(repo_path: String) -> Result<(), AppError> {
    let settings = load_settings().await?;
    if settings.default_editor.is_empty() {
        return Err(AppError::Auth("No default editor configured".to_string()));
    }
    let app_name = editor_app_name(&settings.default_editor).ok_or_else(|| {
        AppError::Auth(format!("Unknown editor: {}", settings.default_editor))
    })?;
    tokio::process::Command::new("open")
        .args(["-a", app_name, &repo_path])
        .spawn()
        .map_err(AppError::Io)?;
    Ok(())
}

/// macOS에서 설치된 코드 편집기 목록을 감지합니다.
/// /Applications 폴더의 .app 번들과 CLI 명령어(which)를 모두 확인하며,
/// 앱 아이콘을 base64 PNG data URI로 반환합니다.
#[tauri::command]
pub async fn detect_installed_editors() -> Result<Vec<EditorInfo>, AppError> {
    // (id, 표시 이름, CLI 명령어, macOS .app 번들 이름)
    let candidates: Vec<(&str, &str, &str, &str)> = vec![
        ("vscode", "Visual Studio Code", "code", "Visual Studio Code.app"),
        ("cursor", "Cursor", "cursor", "Cursor.app"),
        ("antigravity", "Antigravity", "antigravity", "Antigravity.app"),
        ("kiro", "Kiro", "kiro", "Kiro.app"),
        ("zed", "Zed", "zed", "Zed.app"),
        ("sublime", "Sublime Text", "subl", "Sublime Text.app"),
        ("webstorm", "WebStorm", "webstorm", "WebStorm.app"),
        ("intellij", "IntelliJ IDEA", "idea", "IntelliJ IDEA.app"),
        ("fleet", "Fleet", "fleet", "Fleet.app"),
        ("xcode", "Xcode", "xed", "Xcode.app"),
        ("nova", "Nova", "nova", "Nova.app"),
        ("textmate", "TextMate", "mate", "TextMate.app"),
        ("android_studio", "Android Studio", "studio", "Android Studio.app"),
        ("phpstorm", "PhpStorm", "phpstorm", "PhpStorm.app"),
        ("rubymine", "RubyMine", "rubymine", "RubyMine.app"),
        ("goland", "GoLand", "goland", "GoLand.app"),
        ("rider", "Rider", "rider", "Rider.app"),
    ];

    let mut editors = Vec::new();

    for (id, name, command, app_bundle) in candidates {
        let app_path = format!("/Applications/{}", app_bundle);
        let has_app = tokio::fs::metadata(&app_path).await.is_ok();

        let has_cli = tokio::process::Command::new("which")
            .arg(command)
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false);

        if has_app || has_cli {
            let icon = if has_app {
                extract_app_icon(app_bundle).await
            } else {
                None
            };

            editors.push(EditorInfo {
                id: id.to_string(),
                name: name.to_string(),
                command: command.to_string(),
                installed: true,
                icon,
            });
        }
    }

    Ok(editors)
}
