use std::path::Path;

use serde::Serialize;

use crate::error::AppError;

/// 설정 화면 「정보」 칸에 보이는 실행 환경: 설정 파일 위치와 찾은 git·gh.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentInfo {
    pub settings_path: String,
    pub git_path: Option<String>,
    pub git_version: Option<String>,
    pub gh_path: Option<String>,
    pub gh_version: Option<String>,
}

/// `git version 2.43.0 (Apple Git-115)`·`gh version 2.62.0 (2024-12-04)`의 첫 줄에서 버전만 꺼낸다.
fn version_from_output(stdout: &str) -> Option<String> {
    let first = stdout.lines().next()?;
    let mut words = first.split_whitespace();
    match (words.next(), words.next(), words.next()) {
        (Some(_), Some("version"), Some(version)) => Some(version.to_string()),
        _ => None,
    }
}

async fn binary_version(binary: &Path) -> Option<String> {
    let output = tokio::process::Command::new(binary).arg("--version").output().await.ok()?;
    if !output.status.success() {
        return None;
    }
    version_from_output(&String::from_utf8_lossy(&output.stdout))
}

/// PATH에서 찾은 실행 파일 경로. git 작업이 쓰는 것과 같은 PATH로 찾는다.
async fn which(name: &str) -> Option<String> {
    let output = tokio::process::Command::new("which").arg(name).output().await.ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!path.is_empty()).then_some(path)
}

#[tauri::command]
pub async fn get_environment_info() -> Result<EnvironmentInfo, AppError> {
    let git_path = which("git").await;
    let git_version = binary_version(Path::new(git_path.as_deref().unwrap_or("git"))).await;
    let gh = crate::gh::cli::find_gh_binary().ok();
    let gh_version = match &gh {
        Some(path) => binary_version(path).await,
        None => None,
    };
    Ok(EnvironmentInfo {
        settings_path: super::settings::settings_path().to_string_lossy().into_owned(),
        git_path,
        git_version,
        gh_path: gh.map(|p| p.to_string_lossy().into_owned()),
        gh_version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_version_from_git_and_gh_output() {
        assert_eq!(
            version_from_output("git version 2.43.0 (Apple Git-115)\n").as_deref(),
            Some("2.43.0")
        );
        assert_eq!(
            version_from_output("gh version 2.62.0 (2024-12-04)\nhttps://github.com/cli/cli/releases/tag/v2.62.0\n")
                .as_deref(),
            Some("2.62.0")
        );
    }

    #[test]
    fn unexpected_output_has_no_version() {
        assert_eq!(version_from_output(""), None);
        assert_eq!(version_from_output("usage: git [--version]"), None);
    }
}
