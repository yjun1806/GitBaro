//! V35 — commit-message trailer parsing and AI-attribution cross-checking.
//!
//! Trailers are self-reported, so on their own they prove nothing. They become a
//! signal only when cross-checked against session evidence
//! ([`cross_check_attribution`]): "a session edited these files but the commit
//! carries no attribution trailer".
//!
//! Pure string logic — no git2, no IO.

use serde::{Deserialize, Serialize};

use crate::verify::types::{Finding, FindingKind};

use super::truncate_detail;

/// Trailer keys that carry AI attribution by themselves. Compared lowercased.
///
/// `commit-attribution` / `codex-version` cover Codex CLI's `commit_attribution`
/// style, `assisted-by` the Barista-Labs style, `generated-by` the generic one.
const ATTRIBUTION_KEYS: &[&str] = &[
    "assisted-by",
    "ai-assisted-by",
    "generated-by",
    "commit-attribution",
    "codex-version",
];

/// `Co-authored-by` is overwhelmingly used for humans, so it only counts as AI
/// attribution when the value names a known agent.
const COAUTHOR_KEY: &str = "co-authored-by";

/// Lowercase substrings that identify a coding agent inside a trailer value.
/// The matched token is also the normalized agent name.
const AGENT_TOKENS: &[&str] = &[
    "claude", "codex", "copilot", "cursor", "gemini", "aider", "devin",
];

/// One `Key: Value` trailer, key case preserved as written.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitTrailer {
    pub key: String,
    pub value: String,
}

/// Normalized AI attribution derived from a commit message.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiAttribution {
    /// At least one trailer claims AI involvement.
    pub attributed: bool,
    /// Normalized agent names, sorted and deduplicated (e.g. `["claude"]`).
    /// May be empty even when `attributed` is true (key claims AI, value names
    /// no agent we recognize).
    pub agents: Vec<String>,
    /// Only the attribution-bearing trailers. Use [`parse_trailers`] for all.
    pub trailers: Vec<CommitTrailer>,
}

/// Result of comparing an attribution trailer against session-derived evidence.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TrailerCrossCheck {
    /// Trailer present and a session edited files this commit changed.
    #[serde(rename_all = "camelCase")]
    Confirmed { overlapping_files: Vec<String> },
    /// A session edited files this commit changed, but no attribution trailer.
    #[serde(rename_all = "camelCase")]
    MissingTrailer { overlapping_files: Vec<String> },
    /// Trailer claims AI help but there is no session evidence to confirm it.
    /// Not a defect — session logs expire, are disabled, or live elsewhere.
    Unverified,
    /// Neither a trailer nor session overlap.
    NoSignal,
}

/// Parse the commit message's trailer block.
///
/// Follows git's shape with two deliberate tightenings, both aimed at precision
/// over recall (a false trailer is worse than a missed one here):
///
/// 1. A single-paragraph message has no trailers (git behaves the same way).
/// 2. **Every** line of the last paragraph must be a `Key: Value` line or a
///    folded continuation; one non-trailer line disqualifies the whole block.
///    Git accepts a block with only 25% trailer lines, which turns ordinary
///    closing prose into "trailers".
///
/// Folded values (continuation lines starting with whitespace) are unfolded by
/// joining with a single space.
pub fn parse_trailers(message: &str) -> Vec<CommitTrailer> {
    let lines: Vec<&str> = message.lines().collect();

    let mut end = lines.len();
    while end > 0 && lines[end - 1].trim().is_empty() {
        end -= 1;
    }
    if end == 0 {
        return Vec::new();
    }

    let mut start = end;
    while start > 0 && !lines[start - 1].trim().is_empty() {
        start -= 1;
    }
    // The subject paragraph is never a trailer block.
    if start == 0 {
        return Vec::new();
    }

    let mut out: Vec<CommitTrailer> = Vec::new();
    for line in &lines[start..end] {
        if is_continuation(line) {
            let Some(last) = out.last_mut() else {
                return Vec::new();
            };
            let folded = line.trim();
            if last.value.is_empty() {
                last.value.push_str(folded);
            } else {
                last.value.push(' ');
                last.value.push_str(folded);
            }
            continue;
        }
        match split_trailer(line) {
            Some(trailer) => out.push(trailer),
            None => return Vec::new(),
        }
    }
    out
}

fn is_continuation(line: &str) -> bool {
    line.starts_with(' ') || line.starts_with('\t')
}

fn split_trailer(line: &str) -> Option<CommitTrailer> {
    let idx = line.find(':')?;
    let key = &line[..idx];
    if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    let rest = &line[idx + 1..];
    // Rejects bare URLs such as `https://example.com`, whose scheme looks like a
    // trailer key. A real trailer separator is followed by whitespace or nothing.
    if rest.starts_with('/') {
        return None;
    }
    Some(CommitTrailer {
        key: key.to_string(),
        value: rest.trim().to_string(),
    })
}

/// Collapse a commit message's trailers into a normalized AI attribution.
pub fn ai_attribution(message: &str) -> AiAttribution {
    let mut agents: Vec<String> = Vec::new();
    let mut matched: Vec<CommitTrailer> = Vec::new();

    for trailer in parse_trailers(message) {
        let key = trailer.key.to_ascii_lowercase();
        let found = agents_in_value(&trailer.value);
        let by_key = ATTRIBUTION_KEYS.contains(&key.as_str());
        let by_coauthor = key == COAUTHOR_KEY && !found.is_empty();
        if !by_key && !by_coauthor {
            continue;
        }
        for agent in found {
            if !agents.contains(&agent) {
                agents.push(agent);
            }
        }
        matched.push(trailer);
    }

    agents.sort();
    AiAttribution {
        attributed: !matched.is_empty(),
        agents,
        trailers: matched,
    }
}

fn agents_in_value(value: &str) -> Vec<String> {
    let lowered = value.to_ascii_lowercase();
    AGENT_TOKENS
        .iter()
        .filter(|token| lowered.contains(**token))
        .map(|token| (*token).to_string())
        .collect()
}

/// Cross-check the commit's attribution against the files a session edited.
///
/// `commit_files` and `session_edited_files` may mix repo-relative and absolute
/// paths; [`paths_match`] treats one as a suffix of the other on a `/` boundary.
pub fn cross_check_attribution(
    attribution: &AiAttribution,
    commit_files: &[String],
    session_edited_files: &[String],
) -> TrailerCrossCheck {
    let mut overlapping: Vec<String> = commit_files
        .iter()
        .filter(|path| session_edited_files.iter().any(|edited| paths_match(path, edited)))
        .cloned()
        .collect();
    overlapping.sort();
    overlapping.dedup();

    match (attribution.attributed, overlapping.is_empty()) {
        (true, false) => TrailerCrossCheck::Confirmed {
            overlapping_files: overlapping,
        },
        (true, true) => TrailerCrossCheck::Unverified,
        (false, false) => TrailerCrossCheck::MissingTrailer {
            overlapping_files: overlapping,
        },
        (false, true) => TrailerCrossCheck::NoSignal,
    }
}

fn paths_match(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    a.ends_with(&format!("/{}", b)) || b.ends_with(&format!("/{}", a))
}

/// `v35.agentTrailerMismatch` — only [`TrailerCrossCheck::MissingTrailer`] is a
/// finding. An unverified trailer is not a defect (§7-⑥: absent evidence is not
/// negative evidence).
pub fn trailer_finding(check: &TrailerCrossCheck) -> Option<Finding> {
    let TrailerCrossCheck::MissingTrailer { overlapping_files } = check else {
        return None;
    };
    Some(
        Finding::new(
            FindingKind::AgentTrailerMismatch,
            "",
            format!(
                "no AI attribution trailer, but a session edited {} of this commit's files",
                overlapping_files.len()
            ),
        )
        .with_detail(truncate_detail(&overlapping_files.join(", "))),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_paragraph_message_has_no_trailers() {
        assert!(parse_trailers("fix(diff): handle empty blobs").is_empty());
        assert!(parse_trailers("Assisted-by: Claude").is_empty());
    }

    #[test]
    fn parses_multiple_trailers_from_last_paragraph() {
        let message = "feat: add thing\n\nBody text here.\n\nAssisted-by: Claude Opus\nSigned-off-by: Kim <kim@example.com>\n";
        let trailers = parse_trailers(message);
        assert_eq!(trailers.len(), 2);
        assert_eq!(trailers[0].key, "Assisted-by");
        assert_eq!(trailers[0].value, "Claude Opus");
        assert_eq!(trailers[1].key, "Signed-off-by");
    }

    #[test]
    fn unfolds_continuation_lines_with_a_single_space() {
        let message = "feat: x\n\nGenerated-By: Codex CLI\n    version 1.2.3\nAssisted-by: Claude\n";
        let trailers = parse_trailers(message);
        assert_eq!(trailers.len(), 2);
        assert_eq!(trailers[0].value, "Codex CLI version 1.2.3");
        assert_eq!(trailers[1].value, "Claude");
    }

    #[test]
    fn prose_in_the_last_paragraph_disqualifies_the_block() {
        let message = "feat: x\n\nAssisted-by: Claude\nthis line is prose, not a trailer\n";
        assert!(parse_trailers(message).is_empty());
    }

    #[test]
    fn rejects_malformed_trailer_lines() {
        // Missing colon.
        assert!(parse_trailers("feat: x\n\nAssisted-by Claude\n").is_empty());
        // Empty key.
        assert!(parse_trailers("feat: x\n\n: Claude\n").is_empty());
        // Key with a space is not a trailer token.
        assert!(parse_trailers("feat: x\n\nAssisted by: Claude\n").is_empty());
        // Bare URL whose scheme looks like a key.
        assert!(parse_trailers("feat: x\n\nhttps://example.com/issues/1\n").is_empty());
    }

    #[test]
    fn keeps_a_trailer_with_an_empty_value() {
        let trailers = parse_trailers("feat: x\n\nAssisted-by:\n");
        assert_eq!(trailers.len(), 1);
        assert_eq!(trailers[0].value, "");
    }

    #[test]
    fn continuation_without_a_preceding_trailer_is_not_a_block() {
        assert!(parse_trailers("feat: x\n\n  indented prose\nAssisted-by: Claude\n").is_empty());
    }

    #[test]
    fn recognizes_attribution_keys() {
        let attribution = ai_attribution("feat: x\n\nAssisted-by: Claude Opus <noreply@anthropic.com>\n");
        assert!(attribution.attributed);
        assert_eq!(attribution.agents, vec!["claude".to_string()]);
        assert_eq!(attribution.trailers.len(), 1);
    }

    #[test]
    fn recognizes_codex_commit_attribution_style() {
        let attribution = ai_attribution("chore: x\n\nCommit-Attribution: codex-cli\nCodex-Version: 0.48.0\n");
        assert!(attribution.attributed);
        assert_eq!(attribution.agents, vec!["codex".to_string()]);
        assert_eq!(attribution.trailers.len(), 2);
    }

    #[test]
    fn human_coauthor_is_not_ai_attribution() {
        let attribution = ai_attribution("feat: x\n\nCo-authored-by: Jane Doe <jane@example.com>\n");
        assert!(!attribution.attributed);
        assert!(attribution.agents.is_empty());
    }

    #[test]
    fn agent_coauthor_is_ai_attribution() {
        let attribution = ai_attribution("feat: x\n\nCo-authored-by: Claude <noreply@anthropic.com>\n");
        assert!(attribution.attributed);
        assert_eq!(attribution.agents, vec!["claude".to_string()]);
    }

    #[test]
    fn attribution_key_without_a_known_agent_still_counts() {
        let attribution = ai_attribution("feat: x\n\nGenerated-By: some-internal-bot\n");
        assert!(attribution.attributed);
        assert!(attribution.agents.is_empty());
    }

    #[test]
    fn cross_check_flags_session_overlap_without_a_trailer() {
        let attribution = ai_attribution("feat: x\n\nSigned-off-by: Kim <kim@example.com>\n");
        let commit_files = vec!["src/a.ts".to_string(), "src/b.ts".to_string()];
        let session_files = vec!["/Users/kim/repo/src/b.ts".to_string()];
        let check = cross_check_attribution(&attribution, &commit_files, &session_files);
        assert_eq!(
            check,
            TrailerCrossCheck::MissingTrailer {
                overlapping_files: vec!["src/b.ts".to_string()]
            }
        );
        let finding = trailer_finding(&check).expect("missing trailer is a finding");
        assert_eq!(finding.kind, FindingKind::AgentTrailerMismatch);
        assert!(finding.file.is_empty());
    }

    #[test]
    fn cross_check_confirms_when_trailer_and_session_agree() {
        let attribution = ai_attribution("feat: x\n\nAssisted-by: Claude\n");
        let files = vec!["src/a.ts".to_string()];
        let check = cross_check_attribution(&attribution, &files, &files);
        assert!(matches!(check, TrailerCrossCheck::Confirmed { .. }));
        assert!(trailer_finding(&check).is_none());
    }

    #[test]
    fn cross_check_without_session_evidence_is_not_a_finding() {
        let attributed = ai_attribution("feat: x\n\nAssisted-by: Claude\n");
        let files = vec!["src/a.ts".to_string()];
        assert_eq!(
            cross_check_attribution(&attributed, &files, &[]),
            TrailerCrossCheck::Unverified
        );
        assert!(trailer_finding(&TrailerCrossCheck::Unverified).is_none());

        let plain = ai_attribution("feat: x\n\nSigned-off-by: Kim <kim@example.com>\n");
        assert_eq!(
            cross_check_attribution(&plain, &files, &[]),
            TrailerCrossCheck::NoSignal
        );
        assert!(trailer_finding(&TrailerCrossCheck::NoSignal).is_none());
    }
}
