// SPDX-License-Identifier: GPL-3.0-or-later
pub mod commands;
pub mod error;
pub mod events;
pub mod gh;
pub mod git;
pub mod github;
mod shell_env;
pub mod state;
pub mod watcher;

use tauri::{LogicalPosition, LogicalSize, Manager};
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();
    // Before any thread starts or any git/gh/hook process is spawned.
    shell_env::apply_login_shell_path();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(state::TokenStore::new())
        .manage(commands::watch::WatcherState::new())
        // W1-T3
        .manage(commands::activity::ActivityWatcherState::new())
        .invoke_handler(tauri::generate_handler![
            commands::git::get_status,
            commands::git::stage_files,
            commands::git::unstage_files,
            commands::git::create_commit,
            commands::git::get_diff,
            commands::git::discard_changes,
            commands::git::find_conflict_markers,
            commands::git::git_fetch,
            commands::git::git_push,
            commands::git::get_push_target,
            commands::git::git_pull,
            commands::git::list_remote_tags,
            commands::auto_sync::get_auto_sync_snapshot,
            commands::auto_sync::auto_fast_forward,
            commands::git::stash_push,
            commands::git::stash_pop,
            commands::git::stash_pop_by_oid,
            commands::git::stash_list,
            commands::git::stash_apply,
            commands::git::stash_drop,
            commands::git::stash_show,
            commands::git::stash_push_partial,
            commands::git::add_to_gitignore,
            commands::repo::open_repository,
            commands::repo::clone_repository,
            commands::repo::get_open_repos,
            commands::repo::close_repository,
            commands::repo::add_local_repository,
            commands::repo::search_github_repos,
            commands::repo::get_repo_visibility,
            commands::repo::get_owner_type,
            commands::branch::get_branches,
            commands::branch::is_head_detached,
            commands::branch::get_branch_divergence,
            commands::branch::repo_sync_status,
            commands::branch::create_branch,
            commands::branch::switch_branch,
            commands::branch::delete_branch,
            commands::branch::get_current_branch,
            commands::branch::compare_branches,
            commands::branch::merge_branch_into_current,
            commands::branch::get_recent_branches,
            commands::branch::rename_branch,
            commands::branch::check_merge_conflicts,
            commands::branch::get_conflict_file_diff,
            commands::branch::abort_merge_or_rebase,
            commands::branch::continue_merge_or_rebase,
            commands::branch::get_merge_state,
            commands::history::get_commit_history,
            commands::history::get_commit_detail,
            commands::history::get_commit_file_diff,
            commands::history::resolve_commit_avatars,
            commands::history::checkout_commit,
            commands::history::reset_to_commit,
            commands::history::revert_commit,
            commands::history::cherry_pick_commit,
            commands::auth::check_gh_status,
            commands::auth::start_gh_login,
            commands::auth::cancel_gh_login,
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
            commands::settings::detect_installed_terminals,
            commands::settings::detect_installed_ai_clis,
            commands::settings::open_ai_cli_in_terminal,
            commands::worktree::get_worktrees,
            commands::worktree::add_worktree,
            commands::worktree::remove_worktree,
            commands::worktree::start_worktree_preview,
            commands::worktree::stop_worktree_preview,
            commands::worktree::check_preview_active,
            commands::actions::list_workflow_runs,
            commands::actions::get_workflow_run_jobs,
            commands::watch::start_repo_watch,
            commands::watch::stop_repo_watch,
            // W1-T3
            commands::activity::set_activity_watch,
            // W1-T4
            commands::review::review_status,
            commands::review::count_new_commits,
            // W3-T3
            commands::review::list_new_commit_ids,
            // W4-T2
            commands::workspace_history::get_workspace_history,
        ])
        .setup(|app| {
            tracing::info!("GitBaro starting up");

            // Clean up any askpass scripts left behind by a force-killed process.
            git::cli::sweep_stale_askpass();

            // 저장된 window bounds 복원
            let app_handle_for_restore = app.handle().clone();
            let app_state = tauri::async_runtime::block_on(
                state::app_state::load_app_state(&app_handle_for_restore),
            );

            if let Some(bounds) = app_state.window_bounds {
                if let Some(window) = app.get_webview_window("main") {
                    restore_window_bounds(&window, bounds.validated());
                }
            }

            // 창을 닫을 때 window bounds 저장 (Cmd+Q 는 아래 RunEvent 에서 처리)
            let app_handle_for_close = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        save_window_bounds(&app_handle_for_close);
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
        .build(tauri::generate_context!())
        .expect("error while building GitBaro")
        .run(|app_handle, event| {
            // Cmd+Q (app menu Quit) exits without a window CloseRequested event,
            // so save the bounds here while the window still exists. `Exit` is a
            // fallback for quit paths that skip `ExitRequested`.
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                save_window_bounds(app_handle);
            }
        });
}

fn logical_screens(window: &tauri::WebviewWindow) -> Vec<state::app_state::ScreenRect> {
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(screen_rect)
        .collect()
}

fn screen_rect(monitor: &tauri::Monitor) -> state::app_state::ScreenRect {
    let scale = monitor.scale_factor();
    let pos = monitor.position();
    let size = monitor.size();
    state::app_state::ScreenRect {
        x: pos.x as f64 / scale,
        y: pos.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    }
}

/// Apply saved bounds. If they are no longer on any connected monitor (e.g. the
/// external display it was on has been unplugged), center on the primary one.
fn restore_window_bounds(
    window: &tauri::WebviewWindow,
    saved: state::app_state::WindowBounds,
) {
    let screens = logical_screens(window);
    let bounds = if screens.is_empty() || saved.is_visible_on(&screens) {
        saved
    } else {
        let primary = window
            .primary_monitor()
            .ok()
            .flatten()
            .map(|m| screen_rect(&m))
            .unwrap_or(screens[0]);
        tracing::info!(
            "Saved window position ({}, {}) is off-screen, centering on the primary monitor",
            saved.x, saved.y
        );
        saved.centered_on(&primary)
    };

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

/// Persist the main window's position and size (logical pixels).
fn save_window_bounds(handle: &tauri::AppHandle) {
    let Some(win) = handle.get_webview_window("main") else {
        return;
    };
    // A window that is already being torn down cannot report its geometry;
    // saving zeros would overwrite the last good bounds.
    let (Ok(size), Ok(pos)) = (win.outer_size(), win.outer_position()) else {
        return;
    };
    if size.width == 0 || size.height == 0 {
        return;
    }
    let scale = win.scale_factor().unwrap_or(1.0);
    let is_maximized = win.is_maximized().unwrap_or(false);

    // 물리 픽셀 → 논리 픽셀로 변환

    let bounds = state::app_state::WindowBounds {
        x: pos.x as f64 / scale,
        y: pos.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
        maximized: is_maximized,
    };

    tracing::info!(
        "Saving window state: {}x{} at ({}, {}), maximized={}, scale={}",
        bounds.width, bounds.height, bounds.x, bounds.y, bounds.maximized, scale
    );

    tauri::async_runtime::block_on(async {
        let mut state = state::app_state::load_app_state(handle).await;
        state.window_bounds = Some(bounds);
        if let Err(e) = state::app_state::save_app_state(&state).await {
            tracing::error!("Failed to save window state: {}", e);
        }
    });
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
