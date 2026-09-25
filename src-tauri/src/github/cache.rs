//! GitHub 응답을 잠깐 들고 있는 메모리 캐시. 두 가지를 담는다.
//!
//! - REST 조건부 요청: 응답의 `ETag` 와 본문. 다음 요청에 `If-None-Match` 를 붙여 304 를 받으면
//!   들고 있던 본문을 쓴다. 304 는 GitHub 의 시간당 요청 한도에서 빠진다.
//! - GraphQL: ETag 가 없어서 짧은 유효 시간(`GRAPHQL_TTL`) 동안만 같은 질의에 같은 답을 준다.
//!   탭을 오가며 화면이 다시 마운트될 때 같은 질의가 연달아 나가지 않게 한다.
//!
//! 키에는 토큰 자체가 아니라 토큰의 해시를 넣는다(계정마다 볼 수 있는 저장소가 달라 답이 다르다).
//! 앱을 끄면 사라지고 디스크에 남기지 않는다. 본문 하나가 `MAX_BODY_BYTES` 를 넘으면 담지 않고,
//! 전체가 `MAX_TOTAL_BYTES` 를 넘으려 하면 한꺼번에 비운다.

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
/// 이보다 큰 본문(직렬화한 JSON 크기)은 담지 않는다. 큰 PR 의 파일 목록 같은 것이다.
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
/// 담은 본문 크기의 합이 이를 넘으려 하면 한꺼번에 비운다.
const MAX_TOTAL_BYTES: usize = 32 * 1024 * 1024;

struct Entry {
    etag: Option<String>,
    stored_at: Instant,
    body: Value,
    bytes: usize,
}

#[derive(Default)]
struct Store {
    entries: HashMap<String, Entry>,
    total_bytes: usize,
}

impl Store {
    fn remove(&mut self, key: &str) {
        if let Some(old) = self.entries.remove(key) {
            self.total_bytes -= old.bytes;
        }
    }

    fn clear(&mut self) {
        self.entries.clear();
        self.total_bytes = 0;
    }
}

fn store() -> &'static Mutex<Store> {
    static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(Store::default()))
}

/// 담은 본문 크기의 합.
#[cfg(test)]
fn total_bytes() -> usize {
    store().lock().map(|s| s.total_bytes).unwrap_or(0)
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
    let entry = map.entries.get(key)?;
    Some((entry.etag.clone()?, entry.body.clone()))
}

/// `ttl` 안에 저장한 본문.
pub fn fresh(key: &str, ttl: Duration) -> Option<Value> {
    let map = store().lock().ok()?;
    let entry = map.entries.get(key)?;
    (entry.stored_at.elapsed() < ttl).then(|| entry.body.clone())
}

pub fn put(key: String, etag: Option<String>, body: &Value) {
    let bytes = serde_json::to_vec(body).map_or(usize::MAX, |v| v.len());
    let Ok(mut map) = store().lock() else {
        return;
    };
    // 같은 키의 옛 본문은 새것으로 바뀌거나(담을 때) 낡은 것이 된다(담지 않을 때) — 어느 쪽이든 뺀다.
    map.remove(&key);
    if bytes > MAX_BODY_BYTES {
        return;
    }
    if map.entries.len() >= MAX_ENTRIES || map.total_bytes + bytes > MAX_TOTAL_BYTES {
        map.clear();
    }
    map.total_bytes += bytes;
    map.entries.insert(
        key,
        Entry {
            etag,
            stored_at: Instant::now(),
            body: body.clone(),
            bytes,
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

    fn body_of(bytes: usize) -> Value {
        json!({ "blob": "x".repeat(bytes) })
    }

    #[test]
    fn a_body_over_the_per_entry_limit_is_not_kept() {
        let key = cache_key("t", "cache-test-huge");
        put(key.clone(), Some("\"e\"".into()), &body_of(MAX_BODY_BYTES + 1));
        assert!(etag_for(&key).is_none());
        assert!(fresh(&key, Duration::from_secs(60)).is_none());
    }

    #[test]
    fn total_size_stays_under_the_cap() {
        // 항목 수 한도(512) 안에서도 큰 본문이 쌓이면 메모리를 끝없이 쓴다.
        for i in 0..40 {
            put(cache_key("t", &format!("cache-test-total-{i}")), None, &body_of(MAX_BODY_BYTES - 100));
            assert!(total_bytes() <= MAX_TOTAL_BYTES, "{} > {}", total_bytes(), MAX_TOTAL_BYTES);
        }
    }
}
