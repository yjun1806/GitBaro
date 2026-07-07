use base64::Engine as _;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub theme: String,
    pub default_editor: String,
    pub default_shell: String,
    pub default_ai_cli: String,
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

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInfo {
    pub id: String,
    pub name: String,
    pub installed: bool,
    /// base64-encoded PNG app icon (data URI)
    pub icon: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AiCliInfo {
    pub id: String,
    pub name: String,
    pub command: String,
    pub installed: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            theme: "system".to_string(),
            default_editor: "vscode".to_string(),
            default_shell: "terminal".to_string(),
            default_ai_cli: "claude".to_string(),
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
        return Err(AppError::GitCli {
            message: "No default editor configured".to_string(),
            exit_code: None,
        });
    }

    let app_name = editor_app_name(&editor_id).ok_or_else(|| {
        AppError::GitCli {
            message: format!("Unknown editor: {}", editor_id),
            exit_code: None,
        }
    })?;

    // Guard against path traversal: the resolved file must stay within the repo.
    let repo_root = tokio::fs::canonicalize(&repo_path)
        .await
        .map_err(|_| AppError::RepoNotFound(format!("Not a directory: {}", repo_path)))?;
    let full_path = repo_root.join(&file_path);
    let canonical = tokio::fs::canonicalize(&full_path)
        .await
        .map_err(|_| AppError::RepoNotFound(format!("File not found: {}", file_path)))?;
    if !canonical.starts_with(&repo_root) {
        return Err(AppError::GitCli {
            message: "File is outside the repository".to_string(),
            exit_code: None,
        });
    }

    tokio::process::Command::new("open")
        .args(["-a", app_name])
        .arg(&canonical)
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
    let tmp_path = unique_temp_path("gitbaro_icon", "png")
        .to_string_lossy()
        .into_owned();
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

    let base64_str = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    Some(format!("data:image/png;base64,{}", base64_str))
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
        "kitty" => Some("kitty"),
        "hyper" => Some("Hyper"),
        "rio" => Some("Rio"),
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
        return Err(AppError::GitCli {
            message: "No default editor configured".to_string(),
            exit_code: None,
        });
    }
    let app_name = editor_app_name(&settings.default_editor).ok_or_else(|| {
        AppError::GitCli {
            message: format!("Unknown editor: {}", settings.default_editor),
            exit_code: None,
        }
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

/// macOS에서 설치된 터미널 앱 목록을 감지합니다.
#[tauri::command]
pub async fn detect_installed_terminals() -> Result<Vec<TerminalInfo>, AppError> {
    // (id, 표시 이름, macOS .app 번들 이름, 검색 경로)
    let candidates: Vec<(&str, &str, &str, &str)> = vec![
        ("terminal", "Terminal", "Terminal.app", "/System/Applications/Utilities/Terminal.app"),
        ("iterm", "iTerm2", "iTerm.app", "/Applications/iTerm.app"),
        ("warp", "Warp", "Warp.app", "/Applications/Warp.app"),
        ("ghostty", "Ghostty", "Ghostty.app", "/Applications/Ghostty.app"),
        ("alacritty", "Alacritty", "Alacritty.app", "/Applications/Alacritty.app"),
        ("kitty", "kitty", "kitty.app", "/Applications/kitty.app"),
        ("hyper", "Hyper", "Hyper.app", "/Applications/Hyper.app"),
        ("rio", "Rio", "Rio.app", "/Applications/Rio.app"),
    ];

    let mut terminals = Vec::new();

    for (id, name, app_bundle, full_path) in candidates {
        let has_app = tokio::fs::metadata(full_path).await.is_ok();

        if has_app {
            // Terminal.app은 Utilities 폴더에 있으므로 /Applications/ 경로와 별도 처리
            let icon = if id == "terminal" {
                extract_app_icon_at(full_path).await
            } else {
                extract_app_icon(app_bundle).await
            };

            terminals.push(TerminalInfo {
                id: id.to_string(),
                name: name.to_string(),
                installed: true,
                icon,
            });
        }
    }

    Ok(terminals)
}

/// 지정된 절대 경로의 .app 번들에서 아이콘을 추출합니다.
async fn extract_app_icon_at(app_path: &str) -> Option<String> {
    let plist_path = format!("{}/Contents/Info.plist", app_path);

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

    let tmp_path = unique_temp_path("gitbaro_icon", "png")
        .to_string_lossy()
        .into_owned();
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

    let png_bytes = tokio::fs::read(&tmp_path).await.ok()?;
    let _ = tokio::fs::remove_file(&tmp_path).await;

    let base64_str = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    Some(format!("data:image/png;base64,{}", base64_str))
}

/// 설치된 AI CLI 도구 목록을 감지합니다.
#[tauri::command]
pub async fn detect_installed_ai_clis() -> Result<Vec<AiCliInfo>, AppError> {
    let candidates: Vec<(&str, &str, &str)> = vec![
        ("claude", "Claude Code", "claude"),
        ("codex", "OpenAI Codex CLI", "codex"),
        ("gemini", "Gemini CLI", "gemini"),
        ("aider", "Aider", "aider"),
        ("copilot", "GitHub Copilot CLI", "github-copilot-cli"),
    ];

    let mut clis = Vec::new();

    for (id, name, command) in candidates {
        let installed = tokio::process::Command::new("which")
            .arg(command)
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false);

        clis.push(AiCliInfo {
            id: id.to_string(),
            name: name.to_string(),
            command: command.to_string(),
            installed,
        });
    }

    Ok(clis)
}

/// 터미널 ID에서 .app 번들 내 바이너리 경로를 반환합니다.
fn terminal_binary_path(shell_id: &str) -> Option<&'static str> {
    match shell_id {
        "ghostty" => Some("/Applications/Ghostty.app/Contents/MacOS/ghostty"),
        "alacritty" => Some("/Applications/Alacritty.app/Contents/MacOS/alacritty"),
        "kitty" => Some("/Applications/kitty.app/Contents/MacOS/kitty"),
        "rio" => Some("/Applications/Rio.app/Contents/MacOS/rio"),
        "hyper" => Some("/Applications/Hyper.app/Contents/MacOS/Hyper"),
        "warp" => Some("/Applications/Warp.app/Contents/MacOS/stable"),
        _ => None,
    }
}

/// Build a unique temp file path in the per-user temp dir (not the shared,
/// world-writable `/tmp`) to avoid predictable-path symlink races.
fn unique_temp_path(prefix: &str, ext: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    std::env::temp_dir().join(format!("{}_{}_{}.{}", prefix, std::process::id(), nanos, ext))
}

/// Escape a string for embedding inside an AppleScript double-quoted literal.
/// Backslashes MUST be escaped before quotes, otherwise a path containing `\"`
/// can break out of the literal and inject arbitrary AppleScript (→ `do shell
/// script` → RCE).
fn applescript_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// AI CLI ID에서 실행할 커맨드를 조회합니다.
fn ai_cli_command(cli_id: &str) -> Option<&'static str> {
    match cli_id {
        "claude" => Some("claude"),
        "codex" => Some("codex"),
        "gemini" => Some("gemini"),
        "aider" => Some("aider"),
        "copilot" => Some("github-copilot-cli"),
        _ => None,
    }
}

/// 설정된 기본 터미널에서 AI CLI를 실행합니다.
#[tauri::command]
pub async fn open_ai_cli_in_terminal(repo_path: String, cli_id: String) -> Result<(), AppError> {
    let settings = load_settings().await?;

    let cli_command = ai_cli_command(&cli_id).ok_or_else(|| AppError::GitCli {
        message: format!("Unknown AI CLI: {}", cli_id),
        exit_code: None,
    })?;

    // Validate the path is a real directory and canonicalize it. This rejects
    // crafted values and gives us a concrete filesystem path to embed.
    let canonical = tokio::fs::canonicalize(&repo_path)
        .await
        .ok()
        .filter(|p| p.is_dir())
        .ok_or_else(|| AppError::RepoNotFound(format!("Not a directory: {}", repo_path)))?;
    let repo_path = canonical.to_string_lossy().into_owned();

    let shell_id = &settings.default_shell;
    // Shell-escape the path for the `cd '...'`, then AppleScript-escape the whole
    // command below when it is interpolated into an osascript literal.
    let escaped_path = repo_path.replace('\'', "'\\''");
    let script_cmd = format!("cd '{}' && {}", escaped_path, cli_command);

    tracing::info!("[ai-cli] Opening {} in terminal '{}' at {}", cli_command, shell_id, repo_path);

    match shell_id.as_str() {
        "terminal" => {
            // Terminal.app — AppleScript do script (가장 안정적)
            let apple_script = format!(
                r#"tell application "Terminal"
    activate
    do script "{}"
end tell"#,
                applescript_escape(&script_cmd)
            );
            tokio::process::Command::new("osascript")
                .args(["-e", &apple_script])
                .output()
                .await
                .map_err(AppError::Io)?;
        }
        "iterm" => {
            // iTerm2 — AppleScript로 새 창을 만들고 write text로 명령 전달
            // (create window with command는 로그인 셸을 거치지 않아 PATH 문제 발생)
            let apple_script = format!(
                r#"tell application "iTerm"
    activate
    set newWindow to (create window with default profile)
    tell current session of newWindow
        write text "{}"
    end tell
end tell"#,
                applescript_escape(&script_cmd)
            );
            tokio::process::Command::new("osascript")
                .args(["-e", &apple_script])
                .output()
                .await
                .map_err(AppError::Io)?;
        }
        "ghostty" | "alacritty" | "rio" => {
            // 바이너리 직접 실행 + -e 플래그
            let binary = terminal_binary_path(shell_id).unwrap();
            tokio::process::Command::new(binary)
                .args(["-e", "/bin/zsh", "-l", "-i", "-c", &script_cmd])
                .spawn()
                .map_err(AppError::Io)?;
        }
        "kitty" => {
            // kitty는 위치 인수로 명령 전달
            let binary = terminal_binary_path("kitty").unwrap();
            tokio::process::Command::new(binary)
                .args(["/bin/zsh", "-l", "-i", "-c", &script_cmd])
                .spawn()
                .map_err(AppError::Io)?;
        }
        _ => {
            // Warp, Hyper 등 — AppleScript로 앱 활성화 후 명령어 실행
            let app_name = terminal_app_name(shell_id).unwrap_or("Terminal");

            let paste_script = format!(
                r#"tell application "{app}" to activate
set the clipboard to "{cmd}"
repeat 30 times
    delay 0.2
    tell application "System Events"
        if frontmost of process "{app}" then
            if (count of windows of process "{app}") > 0 then
                delay 1.0
                keystroke "v" using command down
                key code 36
                return
            end if
        end if
    end tell
end repeat"#,
                app = app_name,
                cmd = applescript_escape(&script_cmd),
            );
            tokio::process::Command::new("osascript")
                .args(["-e", &paste_script])
                .spawn()
                .map_err(AppError::Io)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applescript_escape_escapes_backslash_before_quote() {
        // Backslash must be doubled first so a `\"` sequence cannot break out
        // of the AppleScript string literal (RCE vector).
        assert_eq!(applescript_escape(r#"a"b"#), r#"a\"b"#);
        assert_eq!(applescript_escape(r"a\b"), r"a\\b");
        // A crafted path segment stays inside the literal after escaping.
        assert_eq!(applescript_escape(r#"\""#), r#"\\\""#);
    }
}
