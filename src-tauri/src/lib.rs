pub mod auth;
pub mod commands;
pub mod concurrency;
pub mod error;
pub mod git;
pub mod github;
pub mod state;
pub mod watcher;

use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::git::get_status,
            commands::git::stage_files,
            commands::git::unstage_files,
            commands::git::create_commit,
            commands::git::get_diff,
            commands::git::discard_changes,
            commands::repo::open_repository,
            commands::repo::clone_repository,
            commands::repo::get_open_repos,
            commands::repo::close_repository,
            commands::repo::add_local_repository,
            commands::branch::get_branches,
            commands::branch::create_branch,
            commands::branch::switch_branch,
            commands::branch::delete_branch,
            commands::branch::get_current_branch,
            commands::history::get_commit_history,
            commands::history::get_commit_detail,
            commands::auth::start_oauth,
            commands::auth::get_accounts,
            commands::auth::remove_account,
            commands::auth::set_repo_account,
            commands::auth::get_repo_account,
            commands::auth::refresh_token,
            commands::diff::get_file_diff,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::settings::get_theme,
            commands::settings::set_theme,
        ])
        .setup(|app| {
            tracing::info!("GitBaro starting up");

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = check_git_cli().await {
                    tracing::warn!("Git CLI check failed: {}", e);
                }
                state::app_state::load_app_state(&app_handle).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running GitBaro");
}

fn init_logging() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("gitbaro=debug,git2=warn"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_file(true)
        .with_line_number(true)
        .with_target(false)
        .init();
}

async fn check_git_cli() -> Result<(), error::AppError> {
    let output = tokio::process::Command::new("git")
        .arg("--version")
        .output()
        .await
        .map_err(|_| error::AppError::GitCliNotFound)?;

    if !output.status.success() {
        return Err(error::AppError::GitCliNotFound);
    }

    let version_str = String::from_utf8_lossy(&output.stdout);
    tracing::info!("Git CLI detected: {}", version_str.trim());
    Ok(())
}
