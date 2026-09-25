//! 새 커밋 알림이 쓰는 커맨드. 알림을 보낼지는 프론트엔드가 정하고, 여기서는 HEAD 가
//! 앞으로만 나아갔는지와 그 사이 커밋만 알려 준다.

use crate::error::AppError;
use crate::git::head_advance::{head_advance, HeadAdvance};
use git2::{Oid, Repository};

/// 워크트리 `repo_path` 의 HEAD 가 `from` 에서 `to` 로 옮긴 것이 새 커밋을 얹은 것인지.
#[tauri::command]
pub async fn get_head_advance(repo_path: String, from: String, to: String) -> Result<HeadAdvance, AppError> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)?;
        Ok(head_advance(&repo, Oid::from_str(&from)?, Oid::from_str(&to)?)?)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}
