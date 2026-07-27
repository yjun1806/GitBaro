//! Shell command classification for V20 (test runs), V21 (verification
//! bypass) and V22 (`/rewind` blind spot).
//!
//! This is deliberately literal token matching, not shell parsing. Spec §7-②
//! is the constraint that shapes the whole file: a handful of false positives
//! and the badge gets ignored entirely. So the analysis is *segment-aware* —
//! a command word only counts in command position, and a redirection only
//! counts when it actually names a file. `2>&1`, `head -n 20` and a `>` inside
//! a quoted string must not read as file mutations.

use crate::verify::types::BashCommandKind;

/// Test-runner invocations. Matched as whitespace-delimited token sequences so
/// `cargo testbed` or a path containing `jest` does not match.
const TEST_MARKERS: &[&[&str]] = &[
    &["cargo", "test"],
    &["cargo", "nextest"],
    &["go", "test"],
    &["pnpm", "test"],
    &["npm", "test"],
    &["yarn", "test"],
    &["bun", "test"],
    &["pnpm", "vitest"],
    &["npx", "vitest"],
    &["npx", "jest"],
    &["vitest"],
    &["jest"],
    &["pytest"],
    &["mocha"],
    &["ctest"],
    &["gradle", "test"],
    &["mvn", "test"],
];

/// Command words that rewrite the working tree when they lead a segment.
const MUTATION_COMMANDS: &[&str] = &["mv", "rm", "cp", "tee", "touch", "truncate", "install"];

/// Result of classifying one command.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BashClassification {
    pub kind: BashCommandKind,
    /// Concrete bypass tokens found, for use as finding evidence (V21).
    pub bypass_markers: Vec<String>,
    /// Paths this command appears to write to (V22). Best-effort: an empty
    /// vec with `kind == FileMutation` still means "something was mutated".
    pub mutated_paths: Vec<String>,
}

/// One `;`/`&&`/`||`/`|`-delimited piece of a command line.
struct Segment {
    tokens: Vec<String>,
    /// Text with quoted regions blanked out, so redirection scanning does not
    /// trip over `echo "a > b"`.
    unquoted: String,
}

impl Segment {
    /// The command word, skipping leading `VAR=value` assignments and `sudo`.
    fn command_word(&self) -> Option<&str> {
        self.tokens
            .iter()
            .map(String::as_str)
            .find(|t| !is_assignment(t) && *t != "sudo" && *t != "command" && *t != "time")
            .map(|t| t.rsplit('/').next().unwrap_or(t))
    }

    fn has(&self, needle: &str) -> bool {
        self.tokens.iter().any(|t| t == needle)
    }
}

fn is_assignment(token: &str) -> bool {
    match token.find('=') {
        Some(idx) if idx > 0 => token[..idx]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_'),
        _ => false,
    }
}

/// Classify a shell command.
///
/// Precedence is deliberate: bypass beats mutation beats test run, because a
/// `git commit --no-verify` inside a test script is the fact worth surfacing.
pub fn classify(command: &str) -> BashClassification {
    let segments = split_segments(command);
    let all_tokens: Vec<String> = segments.iter().flat_map(|s| s.tokens.clone()).collect();

    let bypass_markers = find_bypass_markers(&segments);
    let mut mutated_paths: Vec<String> = Vec::new();
    let mut mutating = false;

    for segment in &segments {
        let (paths, found) = segment_mutations(segment);
        mutating |= found;
        for path in paths {
            if !mutated_paths.contains(&path) {
                mutated_paths.push(path);
            }
        }
    }

    let kind = if !bypass_markers.is_empty() {
        BashCommandKind::HookBypass
    } else if mutating {
        BashCommandKind::FileMutation
    } else if is_test_command(&all_tokens) {
        BashCommandKind::TestRun
    } else {
        BashCommandKind::Other
    };

    BashClassification {
        kind,
        bypass_markers,
        mutated_paths,
    }
}

/// True when the command runs a test suite.
pub fn is_test_command(tokens: &[String]) -> bool {
    TEST_MARKERS
        .iter()
        .any(|marker| contains_sequence(tokens, marker))
}

/// Split on shell separators while tracking quotes, and blank out quoted text
/// so later scanning cannot be fooled by punctuation inside a string.
fn split_segments(command: &str) -> Vec<Segment> {
    let mut segments = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut chars = command.chars().peekable();

    while let Some(c) = chars.next() {
        match quote {
            Some(q) => {
                if c == q {
                    quote = None;
                }
                // Preserve length, drop content.
                current.push(' ');
            }
            None => match c {
                '\'' | '"' | '`' => {
                    quote = Some(c);
                    current.push(' ');
                }
                '\\' => {
                    chars.next();
                    current.push(' ');
                    current.push(' ');
                }
                ';' | '\n' | '|' | '&' => {
                    segments.push(make_segment(&current));
                    current.clear();
                }
                _ => current.push(c),
            },
        }
    }
    segments.push(make_segment(&current));
    segments.retain(|s| !s.tokens.is_empty());
    segments
}

fn make_segment(text: &str) -> Segment {
    Segment {
        tokens: text
            .split_whitespace()
            .map(|t| t.trim_matches(|c| c == '(' || c == ')'))
            .filter(|t| !t.is_empty())
            .map(str::to_string)
            .collect(),
        unquoted: text.to_string(),
    }
}

fn contains_sequence(tokens: &[String], seq: &[&str]) -> bool {
    if seq.is_empty() || tokens.len() < seq.len() {
        return false;
    }
    tokens
        .windows(seq.len())
        .any(|w| w.iter().zip(seq).all(|(t, s)| t == s))
}

fn find_bypass_markers(segments: &[Segment]) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    let mut add = |marker: String| {
        if !found.contains(&marker) {
            found.push(marker);
        }
    };

    for segment in segments {
        let cmd = segment.command_word().unwrap_or_default();
        let is_git = cmd == "git";
        let git_commit = is_git && segment.has("commit");
        let git_push = is_git && segment.has("push");

        for token in &segment.tokens {
            match token.as_str() {
                "--no-verify" => add("--no-verify".into()),
                "--no-gpg-sign" => add("--no-gpg-sign".into()),
                // `-n` is --no-verify on commit, --dry-run on push, and a
                // count almost everywhere else. Only claim the commit case.
                "-n" if git_commit => add("commit -n".into()),
                "-f" | "--force" | "--force-with-lease" if git_push => add("push --force".into()),
                _ => {
                    if token.starts_with("SKIP=") || token.starts_with("HUSKY") {
                        add(token.clone());
                    }
                }
            }
        }

        if cmd == "chmod" {
            add("chmod".into());
        }
        if cmd == "rm" && segment.tokens.iter().any(|t| is_recursive_force(t)) {
            add("rm -rf".into());
        }
        if cmd == "sed" && segment.tokens.iter().any(|t| t == "-i" || t == "--in-place") {
            add("sed -i".into());
        }
    }
    found
}

/// A single-dash flag cluster carrying both recursive and force (`-rf`, `-fr`,
/// `-Rf`). Long options are excluded — `--force` alone is not `rm -rf`.
fn is_recursive_force(token: &str) -> bool {
    if token.starts_with("--") {
        return false;
    }
    let Some(flags) = token.strip_prefix('-') else {
        return false;
    };
    let lower = flags.to_ascii_lowercase();
    lower.contains('r') && lower.contains('f')
}

/// Find file mutations in one segment. Returns the named targets and whether a
/// mutation happened at all (the two can disagree: `cp $A $B` mutates without
/// naming anything we can resolve).
fn segment_mutations(segment: &Segment) -> (Vec<String>, bool) {
    let mut paths = Vec::new();
    let mut mutating = false;

    // Redirections that reach the filesystem. `2>&1`, `>&2` and `> /dev/null`
    // are stream plumbing, not file mutation.
    for target in redirection_targets(&segment.unquoted) {
        if target.starts_with("/dev/") {
            continue;
        }
        mutating = true;
        push_path(&mut paths, &target);
    }

    let Some(cmd) = segment.command_word() else {
        return (paths, mutating);
    };

    let is_sed_inplace =
        cmd == "sed" && segment.tokens.iter().any(|t| t == "-i" || t == "--in-place");
    if !MUTATION_COMMANDS.contains(&cmd) && !is_sed_inplace {
        return (paths, mutating);
    }
    mutating = true;

    // Arguments after the command word are the targets. Skip flags, and for
    // sed skip the script expression.
    let skip = segment
        .tokens
        .iter()
        .position(|t| t == cmd || t.ends_with(&format!("/{}", cmd)))
        .map(|i| i + 1)
        .unwrap_or(0);
    for arg in segment.tokens.iter().skip(skip) {
        if arg.starts_with('-') {
            continue;
        }
        if is_sed_inplace && (arg.contains("s/") || arg.contains("s|") || arg.contains("s#")) {
            continue;
        }
        push_path(&mut paths, arg);
    }

    (paths, mutating)
}

/// Scan for `>` / `>>` redirections whose target is a file.
fn redirection_targets(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut targets = Vec::new();
    let mut i = 0;

    while i < chars.len() {
        if chars[i] != '>' {
            i += 1;
            continue;
        }
        let mut j = i + 1;
        while j < chars.len() && chars[j] == '>' {
            j += 1;
        }
        // `>&1` / `>&2` duplicate a descriptor; nothing is written to disk.
        if j < chars.len() && chars[j] == '&' {
            i = j + 1;
            continue;
        }
        while j < chars.len() && chars[j] == ' ' {
            j += 1;
        }
        let start = j;
        while j < chars.len() && !chars[j].is_whitespace() {
            j += 1;
        }
        if j > start {
            targets.push(chars[start..j].iter().collect::<String>());
        }
        i = j.max(i + 1);
    }
    targets
}

fn push_path(paths: &mut Vec<String>, raw: &str) {
    if let Some(path) = clean_path(raw) {
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
}

/// Keep only arguments that plausibly name a project file.
fn clean_path(raw: &str) -> Option<String> {
    let trimmed = raw.trim_matches(|c| c == '"' || c == '\'' || c == '`' || c == ')' || c == '(');
    if trimmed.is_empty() || trimmed.starts_with('-') || trimmed.starts_with('$') {
        return None;
    }
    // Device files, descriptors and variable expansions are not project files.
    if trimmed.starts_with("/dev/") || trimmed.starts_with('&') || trimmed.contains('$') {
        return None;
    }
    if !trimmed.contains('/') && !trimmed.contains('.') {
        return None;
    }
    Some(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(cmd: &str) -> BashCommandKind {
        classify(cmd).kind
    }

    #[test]
    fn recognises_test_runners() {
        assert_eq!(kind("cargo test --lib"), BashCommandKind::TestRun);
        assert_eq!(kind("pnpm test"), BashCommandKind::TestRun);
        assert_eq!(kind("npx vitest run src/a.test.ts"), BashCommandKind::TestRun);
        assert_eq!(kind("pytest -q"), BashCommandKind::TestRun);
    }

    #[test]
    fn does_not_mistake_lookalikes_for_test_runs() {
        assert_eq!(kind("cargo build"), BashCommandKind::Other);
        assert_eq!(kind("cat src/jesting.ts"), BashCommandKind::Other);
        assert_eq!(kind("git log --oneline"), BashCommandKind::Other);
    }

    #[test]
    fn flags_hook_bypass_commands() {
        let c = classify("git commit --no-verify -m 'wip'");
        assert_eq!(c.kind, BashCommandKind::HookBypass);
        assert!(c.bypass_markers.contains(&"--no-verify".to_string()));

        assert_eq!(kind("git commit -n -m x"), BashCommandKind::HookBypass);
        assert_eq!(kind("SKIP=lint git commit -m x"), BashCommandKind::HookBypass);
        assert_eq!(kind("git push -f origin main"), BashCommandKind::HookBypass);
        assert_eq!(kind("chmod +x script.sh"), BashCommandKind::HookBypass);
        assert_eq!(kind("rm -rf node_modules"), BashCommandKind::HookBypass);
        assert_eq!(kind("sed -i '' 's/a/b/' src/a.ts"), BashCommandKind::HookBypass);
    }

    #[test]
    fn ambiguous_short_flags_only_count_in_the_right_command() {
        assert_eq!(kind("git push -n origin main"), BashCommandKind::Other);
        assert_eq!(kind("head -n 20 src/a.ts"), BashCommandKind::Other);
        assert_eq!(kind("grep -n foo src/a.ts"), BashCommandKind::Other);
        assert_eq!(kind("tail -f build.log"), BashCommandKind::Other);
        // `-f` belongs to `git push`, not to the unrelated segment beside it.
        assert_eq!(kind("git status && tail -f log.txt"), BashCommandKind::Other);
        // `rm` without recursive+force is a mutation, not a bypass.
        assert_eq!(kind("rm build/out.js"), BashCommandKind::FileMutation);
    }

    #[test]
    fn detects_file_mutations_and_names_targets() {
        let c = classify("echo hello > src/generated.ts");
        assert_eq!(c.kind, BashCommandKind::FileMutation);
        assert_eq!(c.mutated_paths, vec!["src/generated.ts".to_string()]);

        let c = classify("cat header.txt >> dist/bundle.js");
        assert_eq!(c.kind, BashCommandKind::FileMutation);
        assert_eq!(c.mutated_paths, vec!["dist/bundle.js".to_string()]);

        let c = classify("mv src/old.rs src/new.rs");
        assert_eq!(c.kind, BashCommandKind::FileMutation);
        assert_eq!(
            c.mutated_paths,
            vec!["src/old.rs".to_string(), "src/new.rs".to_string()]
        );
    }

    #[test]
    fn sed_in_place_reports_the_edited_file_not_the_script() {
        let c = classify("sed -i '' 's/foo/bar/g' src/a.ts");
        assert_eq!(c.mutated_paths, vec!["src/a.ts".to_string()]);
    }

    // ── False-positive guards (spec §7-②) ─────────────────────────────────

    #[test]
    fn stream_plumbing_is_not_a_file_mutation() {
        for cmd in [
            "cargo test 2>&1 | tail -5",
            "pnpm build >&2",
            "ls -la 2>/dev/null",
            "grep -r foo . 2> /dev/null | head",
        ] {
            let c = classify(cmd);
            assert!(
                c.mutated_paths.is_empty(),
                "{} should name no mutated path, got {:?}",
                cmd,
                c.mutated_paths
            );
            assert_ne!(
                c.kind,
                BashCommandKind::FileMutation,
                "{} is not a file mutation",
                cmd
            );
        }
    }

    #[test]
    fn devnull_redirection_alone_is_not_a_mutation() {
        assert_eq!(kind("cargo test > /dev/null"), BashCommandKind::TestRun);
    }

    #[test]
    fn angle_brackets_inside_quotes_do_not_count() {
        let c = classify("echo 'a -> b' && git log --format='%h > %s'");
        assert!(c.mutated_paths.is_empty());
        assert_eq!(c.kind, BashCommandKind::Other);
    }

    #[test]
    fn mutation_words_only_count_in_command_position() {
        // `cp` and `rm` here are arguments/patterns, not the command.
        assert_eq!(kind("grep -rn 'rm' src/"), BashCommandKind::Other);
        assert_eq!(kind("echo mv cp rm"), BashCommandKind::Other);
        // But leading a segment, they do count.
        assert_eq!(kind("git status && rm build/out.js"), BashCommandKind::FileMutation);
    }

    #[test]
    fn env_prefixes_and_sudo_do_not_hide_the_command_word() {
        assert_eq!(kind("FOO=1 BAR=2 rm -rf dist"), BashCommandKind::HookBypass);
        assert_eq!(kind("sudo chmod 777 /etc/hosts"), BashCommandKind::HookBypass);
    }

    #[test]
    fn variable_targets_mutate_without_naming_a_path() {
        let c = classify("cp $SRC $DST");
        assert_eq!(c.kind, BashCommandKind::FileMutation);
        assert!(c.mutated_paths.is_empty(), "an unresolved variable is not a path");
    }

    #[test]
    fn plain_reads_are_other() {
        assert_eq!(kind("cat src/lib.rs"), BashCommandKind::Other);
        assert_eq!(kind("ls -la"), BashCommandKind::Other);
        assert_eq!(kind("git status --short"), BashCommandKind::Other);
        assert_eq!(kind("git diff HEAD~1"), BashCommandKind::Other);
    }

    #[test]
    fn bypass_wins_over_mutation_and_test() {
        assert_eq!(
            kind("pnpm test && git push --force origin main"),
            BashCommandKind::HookBypass
        );
    }

    #[test]
    fn recursive_force_flag_forms() {
        assert!(is_recursive_force("-rf"));
        assert!(is_recursive_force("-fr"));
        assert!(is_recursive_force("-Rf"));
        assert!(!is_recursive_force("-r"));
        assert!(!is_recursive_force("-f"));
        assert!(!is_recursive_force("--force"));
    }
}
