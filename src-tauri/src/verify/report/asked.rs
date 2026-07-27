//! § What was asked — the user's own words, quoted.
//!
//! This section carries exactly one judgement: `compacted_away`. "The third
//! thing you asked for may have fallen out of the agent's context" changes what
//! the reader does next. Everything else here is a quotation, and the quotation
//! is deliberately unprocessed — no summary, no translation, no reordering.
//!
//! The prompts themselves are folded by `session/summary.rs` and already
//! stripped of harness-injected text (`event::sanitize_prompt`), so all this
//! module does is choose how many to show and how to title the page.

use crate::verify::types::SessionSummary;

use super::model::{AskedSection, PromptRecord, Unavailable, UnavailableReason};
use super::MAX_REPORT_PROMPTS;

const MAX_TITLE_CHARS: usize = 80;

pub fn build(summary: &SessionSummary) -> AskedSection {
    if summary.prompts.is_empty() {
        return AskedSection {
            unavailable: Some(Unavailable::with_detail(
                UnavailableReason::NoPrompt,
                "the session log records no user prompt",
            )),
            prompts: Vec::new(),
            total_prompts: 0,
        };
    }

    // The earliest prompts are kept: prompt #0 is the specification anchor and
    // the ones after it are corrections to it. Dropping the head to show the
    // tail would remove the only prompt the rest are relative to.
    let prompts: Vec<PromptRecord> = summary
        .prompts
        .iter()
        .take(MAX_REPORT_PROMPTS)
        .cloned()
        .collect();

    AskedSection {
        unavailable: None,
        prompts,
        total_prompts: summary.prompts.len(),
    }
}

/// The report title: the first prompt's first line, else the branch, else a
/// short session id. Composed here so no frontend ever assembles one.
pub fn title_for(summary: &SessionSummary) -> String {
    let from_prompt = summary
        .prompts
        .first()
        .map(|prompt| prompt.text.as_str())
        .or(summary.first_user_prompt.as_deref())
        .and_then(|text| text.lines().map(str::trim).find(|line| !line.is_empty()))
        .map(|line| crate::verify::session::jsonl::truncate_chars(line, MAX_TITLE_CHARS));

    from_prompt
        .or_else(|| summary.git_branch.clone())
        .unwrap_or_else(|| summary.session_id.chars().take(8).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::report::testutil::{prompt, session_with};

    #[test]
    fn a_session_without_prompts_reports_why_instead_of_an_empty_list() {
        let section = build(&session_with(&[], &[]));
        assert!(section.prompts.is_empty());
        assert_eq!(
            section.unavailable.expect("reason").reason,
            UnavailableReason::NoPrompt
        );
    }

    #[test]
    fn every_prompt_is_carried_not_only_the_first() {
        let mut summary = session_with(&[], &[]);
        summary.prompts = vec![
            prompt(0, "refactor `src/a.rs`"),
            prompt(1, "그리고 `src/b.rs` 도"),
        ];
        let section = build(&summary);
        assert_eq!(section.total_prompts, 2);
        assert_eq!(section.prompts[1].ordinal, 1);
        assert!(section.unavailable.is_none());
    }

    #[test]
    fn an_overlong_conversation_keeps_the_head_and_declares_the_total() {
        let mut summary = session_with(&[], &[]);
        summary.prompts = (0..MAX_REPORT_PROMPTS as u32 + 5)
            .map(|i| prompt(i, &format!("step {i}")))
            .collect();
        let section = build(&summary);
        assert_eq!(section.prompts.len(), MAX_REPORT_PROMPTS);
        assert_eq!(section.total_prompts, MAX_REPORT_PROMPTS + 5);
        assert_eq!(section.prompts[0].text, "step 0");
    }

    #[test]
    fn the_dropped_instruction_flag_survives_the_projection() {
        let mut summary = session_with(&[], &[]);
        let mut early = prompt(0, "first");
        early.compacted_away = true;
        summary.prompts = vec![early, prompt(1, "second")];
        let section = build(&summary);
        assert!(section.prompts[0].compacted_away);
        assert!(!section.prompts[1].compacted_away);
    }

    #[test]
    fn the_title_falls_back_from_prompt_to_branch_to_id() {
        let mut summary = session_with(&[], &[]);
        summary.session_id = "abcdef0123456".into();
        summary.git_branch = Some("feat/x".into());
        summary.prompts = vec![prompt(0, "  \nrefactor the login flow\nmore")];
        assert_eq!(title_for(&summary), "refactor the login flow");

        summary.prompts.clear();
        assert_eq!(title_for(&summary), "feat/x");
        summary.git_branch = None;
        assert_eq!(title_for(&summary), "abcdef01");
    }
}
