pub mod commands;
pub mod concurrency;
pub mod error;
pub mod gh;
pub mod git;
pub mod github;
pub mod state;
pub mod watcher;

use tauri::{LogicalPosition, LogicalSize, Manager};
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
            commands::git::stash_push,
            commands::git::stash_pop,
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
            commands::branch::compare_branches,
            commands::branch::merge_branch_into_current,
            commands::branch::get_recent_branches,
            commands::branch::rename_branch,
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
            commands::settings::reveal_in_finder,
            commands::settings::open_in_terminal,
            commands::settings::open_repo_in_editor,
            commands::worktree::get_worktrees,
            commands::worktree::add_worktree,
            commands::worktree::remove_worktree,
            commands::worktree::start_worktree_preview,
            commands::worktree::stop_worktree_preview,
            commands::worktree::check_preview_active,
        ])
        .setup(|app| {
            tracing::info!("GitBaro starting up");

            // 저장된 window bounds 복원
            let app_handle_for_restore = app.handle().clone();
            let app_state = tauri::async_runtime::block_on(
                state::app_state::load_app_state(&app_handle_for_restore),
            );

            if let Some(bounds) = app_state.window_bounds {
                let bounds = bounds.validated();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_position(LogicalPosition::new(bounds.x, bounds.y));
                    let _ = window.set_size(LogicalSize::new(bounds.width, bounds.height));
                    if bounds.maximized {
                        let _ = window.maximize();
                    }
                    tracing::info!(
                        "Restored window: {}x{} at ({}, {}), maximized={}",
                        bounds.width, bounds.height, bounds.x, bounds.y, bounds.maximized
                    );
                }
            }

            // close 이벤트에서 window bounds 저장
            let app_handle_for_close = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        let handle = app_handle_for_close.clone();
                        if let Some(win) = handle.get_webview_window("main") {
                            let scale = win.scale_factor().unwrap_or(1.0);
                            let is_maximized = win.is_maximized().unwrap_or(false);

                            // 물리 픽셀 → 논리 픽셀로 변환
                            let size = win.outer_size().unwrap_or_default();
                            let pos = win.outer_position().unwrap_or_default();

                            let bounds = state::app_state::WindowBounds {
                                x: pos.x as f64 / scale,
                                y: pos.y as f64 / scale,
                                width: size.width as f64 / scale,
                                height: size.height as f64 / scale,
                                maximized: is_maximized,
                            };

                            tracing::info!(
                                "Saving window state: {}x{} at ({}, {}), maximized={}, scale={}",
                                bounds.width, bounds.height, bounds.x, bounds.y,
                                bounds.maximized, scale
                            );

                            tauri::async_runtime::block_on(async {
                                let mut state =
                                    state::app_state::load_app_state(&handle).await;
                                state.window_bounds = Some(bounds);
                                if let Err(e) = state::app_state::save_app_state(&state).await {
                                    tracing::error!("Failed to save window state: {}", e);
                                }
                            });
                        }
                    }
                });
            }

            tauri::async_runtime::spawn(async move {
                if let Err(e) = check_git_cli().await {
                    tracing::warn!("Git CLI check failed: {}", e);
                }
                if let Err(e) = check_gh_cli().await {
                    tracing::warn!("GitHub CLI check: {}", e);
                }
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
