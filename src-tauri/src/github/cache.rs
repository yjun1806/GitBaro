//! GitHub 응답을 잠깐 들고 있는 메모리 캐시. 두 가지를 담는다.
//!
//! - REST 조건부 요청: 응답의 `ETag` 와 본문. 다음 요청에 `If-None-Match` 를 붙여 304 를 받으면
//!   들고 있던 본문을 쓴다. 304 는 GitHub 의 시간당 요청 한도에서 빠진다.
//! - GraphQL: ETag 가 없어서 짧은 유효 시간(`GRAPHQL_TTL`) 동안만 같은 질의에 같은 답을 준다.
//!   탭을 오가며 화면이 다시 마운트될 때 같은 질의가 연달아 나가지 않게 한다.
//!
//! 키에는 토큰 자체가 아니라 토큰의 해시를 넣는다(계정마다 볼 수 있는 저장소가 달라 답이 다르다).
//! 앱을 끄면 사라지고 디스크에 남기지 않는다.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;

/// GraphQL 답을 다시 쓰는 시간.
pub const GRAPHQL_TTL: Duration = Duration::from_secs(20);
/// 항목이 이 수를 넘으면 한꺼번에 비운다. PR 화면 몇 개 분량이면 충분하다.
const MAX_ENTRIES: usize = 512;

struct Entry {
    etag: Option<String>,
    stored_at: Instant,
    body: Value,
}

fn store() -> &'static Mutex<HashMap<String, Entry>> {
    static STORE: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 캐시 키. 토큰은 해시로만 섞는다.
pub fn cache_key(token: &str, request: &str) -> String {
    let mut hasher = DefaultHasher::new();
    token.hash(&mut hasher);
    format!("{:016x}:{}", hasher.finish(), request)
}

/// 조건부 요청에 붙일 ETag 와 그때의 본문.
pub fn etag_for(key: &str) -> Option<(String, Value)> {
    let map = store().lock().ok()?;
    let entry = map.get(key)?;
    Some((entry.etag.clone()?, entry.body.clone()))
}

/// `ttl` 안에 저장한 본문.
pub fn fresh(key: &str, ttl: Duration) -> Option<Value> {
    let map = store().lock().ok()?;
    let entry = map.get(key)?;
    (entry.stored_at.elapsed() < ttl).then(|| entry.body.clone())
}

pub fn put(key: String, etag: Option<String>, body: &Value) {
    let Ok(mut map) = store().lock() else {
        return;
    };
    if map.len() >= MAX_ENTRIES {
        map.clear();
    }
    map.insert(
        key,
        Entry {
            etag,
            stored_at: Instant::now(),
            body: body.clone(),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keys_differ_by_token_and_do_not_contain_it() {
        let a = cache_key("token-a", "/repos/o/r/pulls");
        let b = cache_key("token-b", "/repos/o/r/pulls");
        assert_ne!(a, b);
        assert!(!a.contains("token-a"));
        assert!(a.ends_with("/repos/o/r/pulls"));
    }

    #[test]
    fn fresh_respects_ttl_and_etag_needs_an_etag() {
        let key = cache_key("t", "cache-test-ttl");
        put(key.clone(), None, &json!({"n": 1}));
        assert_eq!(fresh(&key, Duration::from_secs(60)), Some(json!({"n": 1})));
        assert_eq!(fresh(&key, Duration::ZERO), None);
        assert!(etag_for(&key).is_none());

        put(key.clone(), Some("\"abc\"".into()), &json!({"n": 2}));
        assert_eq!(etag_for(&key), Some(("\"abc\"".to_string(), json!({"n": 2}))));
    }
}
