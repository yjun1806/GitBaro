//! Per-rule on/off persistence (contract §2.5, spec §7-②).
//!
//! The file is a sparse overlay: only rules the user explicitly toggled are
//! stored. Everything else follows `registry::default_enabled`, so shipping a
//! new rule does not require migrating anyone's settings file.
//!
//! Loading follows `state/app_state.rs`: a missing or corrupt file degrades to
//! defaults rather than failing, because a settings read must never break a scan.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::error::AppError;
use crate::state::app_state::get_state_dir;

use super::registry;

const CONFIG_FILE: &str = "verify-rules.json";

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RuleConfig {
    /// rule_id → enabled. Absent keys follow the registry default.
    pub enabled: BTreeMap<String, bool>,
}

impl RuleConfig {
    pub fn is_enabled(&self, rule_id: &str) -> bool {
        match self.enabled.get(rule_id) {
            Some(enabled) => *enabled,
            None => registry::default_enabled(rule_id),
        }
    }

    /// Record an explicit user choice.
    pub fn set(&mut self, rule_id: impl Into<String>, enabled: bool) {
        self.enabled.insert(rule_id.into(), enabled);
    }
}

fn config_path() -> PathBuf {
    get_state_dir().join(CONFIG_FILE)
}

/// `~/Library/Application Support/com.gitbaro.app/verify-rules.json`.
pub fn load_rule_config() -> RuleConfig {
    let path = config_path();
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return RuleConfig::default(),
        Err(e) => {
            warn!(
                "[verify] could not read {:?}: {} — using rule defaults",
                path, e
            );
            return RuleConfig::default();
        }
    };

    match serde_json::from_str(&raw) {
        Ok(config) => config,
        Err(e) => {
            warn!(
                "[verify] could not parse {:?}: {} — using rule defaults",
                path, e
            );
            RuleConfig::default()
        }
    }
}

pub fn save_rule_config(config: &RuleConfig) -> Result<(), AppError> {
    let path = config_path();
    let json = serde_json::to_string_pretty(config)?;
    std::fs::write(&path, json)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_keys_follow_the_registry_default() {
        let config = RuleConfig::default();
        assert!(config.is_enabled("v2.testSkipAdded"));
        assert!(!config.is_enabled("v3.vacuousAssertion"));
    }

    #[test]
    fn explicit_choice_wins_over_the_default() {
        let mut config = RuleConfig::default();
        config.set("v2.testSkipAdded", false);
        config.set("v3.vacuousAssertion", true);
        assert!(!config.is_enabled("v2.testSkipAdded"));
        assert!(config.is_enabled("v3.vacuousAssertion"));
    }

    #[test]
    fn unknown_rule_is_off() {
        assert!(!RuleConfig::default().is_enabled("v99.nope"));
    }

    #[test]
    fn config_round_trips_through_json() {
        let mut config = RuleConfig::default();
        config.set("v12.uncoveredNewLines", true);
        let json = serde_json::to_string(&config).expect("serialize");
        let back: RuleConfig = serde_json::from_str(&json).expect("deserialize");
        assert!(back.is_enabled("v12.uncoveredNewLines"));
    }
}
