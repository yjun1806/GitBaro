//! The **only** networked code in V4, reached solely when the caller passes
//! `allow_registry = true`. Keeping it in one file is what lets the offline path
//! promise "zero network" without anyone having to audit the whole module.
//!
//! Registry answers are enrichment, never a prerequisite: any failure here
//! degrades to `ScanLimit{MissingArtifact}` and the offline findings stand.
//!
//! Not unit-tested by design — a test that hits `registry.npmjs.org` is not
//! hermetic (contract §7). Only the pure threshold logic below is tested.

use std::time::Duration;

use crate::error::AppError;

const NPM_REGISTRY_BASE: &str = "https://registry.npmjs.org";
const NPM_DOWNLOADS_BASE: &str = "https://api.npmjs.org/downloads/point/last-week";

/// Contract §5: 3 second timeout, opt-in, failure is not an error.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
/// One diff should not fan out into a hundred requests.
const MAX_LOOKUPS: usize = 20;
/// spec §V4 — a package registered days before an agent "remembered" it is the
/// slopsquatting signature.
const NEW_PACKAGE_DAYS: i64 = 90;
const LOW_WEEKLY_DOWNLOADS: u64 = 100;

const MILLIS_PER_DAY: i64 = 86_400_000;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RegistryFacts {
    pub name: String,
    pub exists: bool,
    /// Epoch milliseconds of the first publish (`time.created`).
    pub first_published_at: Option<i64>,
    pub weekly_downloads: Option<u64>,
}

/// Why a package that *does* exist is still worth a second look, or `None`.
pub fn suspicion_reason(facts: &RegistryFacts, now_millis: i64) -> Option<String> {
    if let Some(published) = facts.first_published_at {
        let days = (now_millis - published) / MILLIS_PER_DAY;
        if (0..NEW_PACKAGE_DAYS).contains(&days) {
            return Some(format!("was first published {} days ago", days));
        }
    }
    if let Some(downloads) = facts.weekly_downloads {
        if downloads < LOW_WEEKLY_DOWNLOADS {
            return Some(format!("has {} downloads in the last week", downloads));
        }
    }
    None
}

/// npm names may only contain these characters; anything else is refused rather
/// than interpolated into a URL.
fn is_lookup_safe(name: &str) -> bool {
    let body = name.strip_prefix('@').unwrap_or(name);
    !body.is_empty()
        && body.len() <= 214
        && !body.starts_with('.')
        && body
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'))
        && body.matches('/').count() <= 1
}

fn encode(name: &str) -> String {
    name.replace('/', "%2f")
}

pub async fn lookup_npm_packages(names: &[String]) -> Result<Vec<RegistryFacts>, AppError> {
    let client = reqwest::Client::builder()
        .user_agent("GitBaro")
        .timeout(REQUEST_TIMEOUT)
        .build()?;

    let mut out = Vec::new();
    for name in names.iter().take(MAX_LOOKUPS) {
        if !is_lookup_safe(name) {
            continue;
        }
        out.push(lookup_one(&client, name).await?);
    }
    Ok(out)
}

async fn lookup_one(client: &reqwest::Client, name: &str) -> Result<RegistryFacts, AppError> {
    let encoded = encode(name);
    let response = client
        .get(format!("{}/{}", NPM_REGISTRY_BASE, encoded))
        .send()
        .await?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(RegistryFacts {
            name: name.to_string(),
            exists: false,
            ..RegistryFacts::default()
        });
    }
    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "npm registry returned {} for {}",
            response.status(),
            name
        )));
    }

    let body: serde_json::Value = response.json().await?;
    let first_published_at = body
        .get("time")
        .and_then(|time| time.get("created"))
        .and_then(|created| created.as_str())
        .and_then(parse_rfc3339_millis);

    Ok(RegistryFacts {
        name: name.to_string(),
        exists: true,
        first_published_at,
        weekly_downloads: weekly_downloads(client, &encoded).await,
    })
}

/// Download counts are a nice-to-have; a failure here must not sink the lookup.
async fn weekly_downloads(client: &reqwest::Client, encoded_name: &str) -> Option<u64> {
    let response = client
        .get(format!("{}/{}", NPM_DOWNLOADS_BASE, encoded_name))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let body: serde_json::Value = response.json().await.ok()?;
    body.get("downloads").and_then(|d| d.as_u64())
}

fn parse_rfc3339_millis(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|parsed| parsed.timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000_000;

    fn facts(published_days_ago: Option<i64>, downloads: Option<u64>) -> RegistryFacts {
        RegistryFacts {
            name: "pkg".to_string(),
            exists: true,
            first_published_at: published_days_ago.map(|days| NOW - days * MILLIS_PER_DAY),
            weekly_downloads: downloads,
        }
    }

    #[test]
    fn young_packages_are_suspicious() {
        let reason = suspicion_reason(&facts(Some(3), Some(1_000_000)), NOW);
        assert_eq!(reason.as_deref(), Some("was first published 3 days ago"));
    }

    #[test]
    fn established_popular_packages_are_not_flagged() {
        assert!(suspicion_reason(&facts(Some(2_000), Some(1_000_000)), NOW).is_none());
    }

    #[test]
    fn low_download_counts_are_suspicious() {
        let reason = suspicion_reason(&facts(Some(2_000), Some(4)), NOW);
        assert_eq!(reason.as_deref(), Some("has 4 downloads in the last week"));
    }

    #[test]
    fn missing_facts_never_invent_a_reason() {
        assert!(suspicion_reason(&facts(None, None), NOW).is_none());
    }

    #[test]
    fn lookup_names_are_validated_before_they_reach_a_url() {
        assert!(is_lookup_safe("react"));
        assert!(is_lookup_safe("@scope/pkg"));
        assert!(!is_lookup_safe("../../etc/passwd"));
        assert!(!is_lookup_safe("pkg?query=1"));
        assert!(!is_lookup_safe("a/b/c"));
        assert!(!is_lookup_safe(""));
    }

    #[test]
    fn scoped_names_are_percent_encoded() {
        assert_eq!(encode("@scope/pkg"), "@scope%2fpkg");
        assert_eq!(encode("react"), "react");
    }

    #[test]
    fn npm_created_timestamps_parse() {
        let parsed = parse_rfc3339_millis("2011-11-19T00:36:38.194Z").expect("rfc3339");
        assert_eq!(parsed, 1_321_662_998_194);
        assert!(parse_rfc3339_millis("not a date").is_none());
    }
}
