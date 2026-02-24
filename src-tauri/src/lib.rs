pub mod commands;
pub mod concurrency;
pub mod error;
pub mod gh;
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
        .manage(state::TokenStore::new())
        .invoke_handler(tauri::generate_handler![
            commands::git::get_status,
            commands::git::stage_files,
            commands::git::unstage_files,
            commands::git::create_commit,
            commands::git::get_diff,
            commands::git::discard_changes,
            commands::git::git_fetch,
            commands::git::git_push,
            commands::git::git_pull,
            commands::repo::open_repository,
            commands::repo::clone_repository,
            commands::repo::get_open_repos,
            commands::repo::close_repository,
            commands::repo::add_local_repository,
            commands::repo::search_github_repos,
            commands::repo::get_repo_visibility,
            commands::repo::get_owner_type,
            commands::branch::get_branches,
            commands::branch::create_branch,
            commands::branch::switch_branch,
            commands::branch::delete_branch,
            commands::branch::get_current_branch,
            commands::history::get_commit_history,
            commands::history::get_commit_detail,
            commands::history::get_commit_file_diff,
            commands::history::resolve_commit_avatars,
            commands::auth::check_gh_status,
            commands::auth::start_gh_login,
            commands::auth::get_accounts,
            commands::auth::remove_account,
            commands::auth::set_repo_account,
            commands::auth::get_repo_account,
            commands::auth::validate_token,
            commands::diff::get_file_diff,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::settings::get_theme,
            commands::settings::set_theme,
            commands::settings::detect_installed_editors,
            commands::settings::open_in_editor,
        ])
        .setup(|app| {
            tracing::info!("GitBaro starting up");

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = check_git_cli().await {
                    tracing::warn!("Git CLI check failed: {}", e);
                }
                if let Err(e) = check_gh_cli().await {
                    tracing::warn!("GitHub CLI check: {}", e);
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

async fn check_gh_cli() -> Result<(), error::AppError> {
    let version = gh::cli::check_gh_version().await?;
    tracing::info!("GitHub CLI detected: gh {}", version);
    Ok(())
}
