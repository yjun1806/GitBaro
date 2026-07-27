//! V26 `v26.promptScopeDrift` — § What differs from what was asked.
//!
//! The largest study of agent failures found the dominant one is *"understood
//! the request wrongly and implemented that misunderstanding correctly"*. It
//! leaves no suspicious artifact, so no static check can see it. The only way
//! to see it is to compare what changed against **what was actually asked for**,
//! and the request is only readable on local disk, in the session log.
//!
//! Four pure stages, no network and no model:
//!
//! 1. **extract** — path-like mentions from *every* user prompt (G3).
//! 2. **reject** — stopwords, versions and short tokens, *before* resolution.
//! 3. **resolve** — against the repository, first hit wins; any ambiguity is
//!    left unresolved rather than guessed (G4).
//! 4. **compare** — resolved anchors against the changed set.
//!
//! **G1 governs everything.** Zero resolved anchors ends the section with
//! `NoResolvableAnchor`; drift is never reported. "로그인 리팩터링 해줘" names
//! no path, so the honest output is nothing at all — not "everything drifted".

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use crate::verify::context::model::is_test_path;
use crate::verify::context::RepoIndex;
use crate::verify::types::{Finding, FindingKind, LinkConfidence};

use super::model::{
    AnchorKind, DriftSection, DriftVerdict, DriftedPath, ImpactBasis, MentionExtractor,
    PromptMention, PromptRecord, ResolvedAnchor, Unavailable, UnavailableReason,
};
use super::{MAX_DRIFT_PATHS, MAX_PROMPT_MENTIONS, MIN_ANCHOR_COVERAGE};

/// Extensions that make a bare token a plausible file reference.
const SOURCE_EXTENSIONS: &[&str] = &[
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "json", "md", "toml", "yaml", "yml", "css",
    "scss", "html", "sql", "sh",
];

/// Fenced blocks in these languages are examples, not instructions. A path
/// inside a shell snippet is something the human ran, not something they asked
/// for, so the whole block is dropped before extraction.
const EXAMPLE_FENCES: &[&str] = &["bash", "sh", "zsh", "shell", "console", "text", ""];

/// Words that name *kinds* of things, not places. Applied **before**
/// resolution: if `test` were allowed to resolve to a `test/` directory, then
/// "테스트 고쳐줘" would make the entire repository drift.
const STOPWORDS: &[&str] = &[
    "test", "tests", "testing", "code", "build", "run", "fix", "bug", "api", "ui", "type", "types",
    "error", "errors", "main", "src", "lib", "app", "util", "utils", "config", "setup", "index",
    "data", "file", "files", "function", "class", "method", "코드", "테스트", "파일", "함수",
    "버그", "수정", "에러", "데이터", "설정",
];

/// Files whose change is a *consequence* of an edit, not a new area of work.
const SIDE_EFFECT_FILES: &[&str] = &[
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lockb",
    "Cargo.lock",
    "CHANGELOG.md",
];

/// One changed path with the numbers the section needs to rank and describe it.
#[derive(Clone, Debug)]
pub struct ChangedPath {
    pub path: String,
    /// Session churn for this path; 0 when the path only appears in a commit.
    pub edit_count: u32,
    pub added_lines: Option<u32>,
    pub removed_lines: Option<u32>,
    /// Previous path when the change is a rename — a moved in-scope file must
    /// not read as drift on its new location.
    pub renamed_from: Option<String>,
}

/// What the repository looks like, resolved once and reused by every mention.
pub struct RepoAnchors {
    pub files: BTreeSet<String>,
    pub dirs: BTreeSet<String>,
    /// `Some("src")` when the repository really does map `@/*` in its tsconfig.
    pub path_alias: Option<String>,
}

impl RepoAnchors {
    /// Build from a tracked-file list. Directories are derived, so a repository
    /// listing is the only input required.
    pub fn new(files: BTreeSet<String>, path_alias: Option<String>) -> Self {
        let mut dirs = BTreeSet::new();
        for file in &files {
            let mut prefix = String::new();
            for segment in file.split('/').rev().skip(1).collect::<Vec<_>>().iter().rev() {
                if !prefix.is_empty() {
                    prefix.push('/');
                }
                prefix.push_str(segment);
                dirs.insert(prefix.clone());
            }
        }
        Self {
            files,
            dirs,
            path_alias,
        }
    }
}

/// Detect a real `@/*` mapping. A substring test rather than a JSON parse:
/// `tsconfig.json` is JSONC in practice, and the only question asked here is
/// whether the alias exists at all.
pub fn detect_path_alias(repo_root: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(repo_root.join("tsconfig.json")).ok()?;
    raw.contains("\"@/*\"").then(|| "src".to_string())
}

pub struct DriftInput<'a> {
    pub prompts: &'a [PromptRecord],
    pub anchors: &'a RepoAnchors,
    pub index: Option<&'a RepoIndex>,
    pub changed: &'a [ChangedPath],
    pub basis: ImpactBasis,
    /// `Some(High)` is required for a `High` drift verdict.
    pub attribution: Option<LinkConfidence>,
    /// The log was only partially observed — an anchor may be in the tail we
    /// never read (G7).
    pub partial_log: bool,
}

pub fn build(input: &DriftInput<'_>) -> DriftSection {
    if input.prompts.is_empty() {
        return unavailable(
            Unavailable::with_detail(
                UnavailableReason::NoPrompt,
                "the session log records no user prompt to compare against",
            ),
            input.basis,
        );
    }

    let mentions = resolve_mentions(input);
    let anchors: Vec<&ResolvedAnchor> = mentions
        .iter()
        .filter_map(|mention| mention.resolved.as_ref())
        .collect();

    // ── G1 ────────────────────────────────────────────────────────────────
    if anchors.is_empty() {
        return DriftSection {
            unavailable: Some(Unavailable::with_detail(
                UnavailableReason::NoResolvableAnchor,
                format!(
                    "no prompt named a path or symbol this repository could resolve ({} mention(s) examined)",
                    mentions.len()
                ),
            )),
            mentions,
            in_scope_paths: Vec::new(),
            drifted_paths: Vec::new(),
            drifted_total: 0,
            changed_total: 0,
            verdict: DriftVerdict::NoAnchor,
            confidence: LinkConfidence::Low,
            basis: input.basis,
        };
    }

    if input.changed.is_empty() {
        return unavailable(
            Unavailable::with_detail(
                UnavailableReason::NotApplicable,
                "this session changed no file, so there is nothing to compare",
            ),
            input.basis,
        );
    }

    let (in_scope, drifted) = partition(&anchors, input.changed);
    let changed_total = input.changed.len();
    let coverage = in_scope.len() as f32 / changed_total as f32;

    let mut verdict = if drifted.is_empty() {
        DriftVerdict::WithinScope
    } else if in_scope.is_empty() {
        DriftVerdict::FullDrift
    } else {
        DriftVerdict::PartialDrift
    };
    let mut confidence = grade(anchors.len(), coverage, input.attribution);

    // ── G2 ── A prompt that mentioned a path only *in passing* produces a
    // sliver of coverage. That is too thin to rank paths by, but it is not the
    // "none of the named paths changed" case, which is coverage of exactly
    // zero and stays `FullDrift`.
    if coverage > 0.0 && coverage < MIN_ANCHOR_COVERAGE {
        confidence = LinkConfidence::Low;
    }
    // ── G7 ── The tail of the log was never read; an anchor may be in it.
    if input.partial_log {
        confidence = downgrade(confidence);
        if verdict == DriftVerdict::FullDrift {
            verdict = DriftVerdict::PartialDrift;
        }
    }
    // Session edits alone are a weaker baseline than an attributed commit range.
    if input.basis == ImpactBasis::WorktreeFallback {
        confidence = downgrade(confidence);
    }

    let drifted_total = drifted.len();
    let mut drifted_paths: Vec<DriftedPath> = drifted
        .into_iter()
        .map(|changed| DriftedPath {
            edit_count: changed.edit_count,
            added_lines: changed.added_lines,
            removed_lines: changed.removed_lines,
            is_test: is_test_path(&changed.path),
            path: changed.path.clone(),
        })
        .collect();
    drifted_paths.sort_by(|a, b| {
        b.edit_count
            .cmp(&a.edit_count)
            .then_with(|| a.path.cmp(&b.path))
    });
    drifted_paths.truncate(MAX_DRIFT_PATHS);

    DriftSection {
        unavailable: None,
        mentions,
        in_scope_paths: in_scope,
        drifted_paths,
        drifted_total,
        changed_total,
        verdict,
        confidence,
        basis: input.basis,
    }
}

/// The rule's finding form, so V26 is a real registry entry rather than a
/// section the rule table knows nothing about.
///
/// The message states counts and paths. It carries **no judgement word** —
/// whether drift is wrong depends on what the human meant, and this rule cannot
/// know that.
pub fn findings(section: &DriftSection) -> Vec<Finding> {
    if section.unavailable.is_some() {
        return Vec::new();
    }
    let sample: Vec<&str> = section
        .drifted_paths
        .iter()
        .take(3)
        .map(|p| p.path.as_str())
        .collect();

    match section.verdict {
        DriftVerdict::PartialDrift => vec![Finding::new(
            FindingKind::PromptScopeDrift,
            "",
            format!(
                "{} of {} changed path(s) were not named in any prompt",
                section.drifted_total, section.changed_total
            ),
        )
        .with_detail(sample.join(", "))],
        DriftVerdict::FullDrift => vec![Finding::new(
            FindingKind::PromptScopeDrift,
            "",
            format!(
                "the prompt named {} path(s); none of the {} changed path(s) is inside them",
                section
                    .mentions
                    .iter()
                    .filter(|m| m.resolved.is_some())
                    .count(),
                section.changed_total
            ),
        )
        .with_detail(sample.join(", "))],
        DriftVerdict::WithinScope | DriftVerdict::NoAnchor => Vec::new(),
    }
}

// ── Stage A + B + C ──────────────────────────────────────────────────────────

fn resolve_mentions(input: &DriftInput<'_>) -> Vec<PromptMention> {
    let mut seen: BTreeMap<String, (MentionExtractor, u32)> = BTreeMap::new();

    for prompt in input.prompts {
        for (raw, extractor) in extract(&prompt.text, input.index.is_some()) {
            if reject(&raw) {
                continue;
            }
            seen.entry(raw)
                .and_modify(|slot| {
                    if extractor > slot.0 {
                        slot.0 = extractor;
                    }
                })
                .or_insert((extractor, prompt.ordinal));
        }
    }

    let mut mentions: Vec<PromptMention> = seen
        .into_iter()
        .map(|(raw, (extractor, ordinal))| PromptMention {
            resolved: resolve(&raw, extractor, input),
            raw,
            extractor,
            prompt_ordinal: ordinal,
        })
        .filter(worth_showing)
        .collect();

    // Resolved anchors first: they are the ones that decide the verdict, so
    // they must survive the cap.
    mentions.sort_by(|a, b| {
        b.resolved
            .is_some()
            .cmp(&a.resolved.is_some())
            .then_with(|| a.prompt_ordinal.cmp(&b.prompt_ordinal))
            .then_with(|| a.raw.cmp(&b.raw))
    });
    mentions.truncate(MAX_PROMPT_MENTIONS);
    mentions
}

/// Real prompts are full of backticked things that were never paths — Tailwind
/// classes (`bg-muted`, `inline-flex`), type names, CLI flags — and of prose
/// alternations that merely contain a slash (`JS/Rust`, `pushed/unpushed`).
/// They resolve to nothing, so they never narrow scope (G4), but listing thirty
/// of them turns this section back into the undifferentiated pile the rewrite
/// exists to end.
///
/// Anything that resolved is kept unconditionally. Anything that did not has to
/// look like a path: a file extension somewhere, or more structure than a bare
/// `A/B`.
fn worth_showing(mention: &PromptMention) -> bool {
    if mention.resolved.is_some() {
        return true;
    }
    let raw = &mention.raw;
    if raw.split('/').any(has_source_extension) {
        return true;
    }
    raw.split('/').filter(|s| !s.is_empty()).count() > 2
}

/// Stage A. Four extractors over one preprocessed copy of the prompt.
fn extract(text: &str, has_index: bool) -> Vec<(String, MentionExtractor)> {
    let text = preprocess(text);
    let mut out: Vec<(String, MentionExtractor)> = Vec::new();

    // Backtick spans first: the strongest signal, and split on separators so
    // `a.ts, b.ts` yields two mentions.
    for (i, span) in text.split('`').enumerate() {
        if i % 2 == 0 {
            continue;
        }
        for token in span.split(|c: char| c.is_whitespace() || c == ',') {
            if let Some(clean) = clean_token(token) {
                out.push((clean, MentionExtractor::Backtick));
            }
        }
    }

    for token in text.split_whitespace() {
        let Some(clean) = clean_token(token) else {
            continue;
        };
        if looks_like_path(&clean) {
            out.push((clean.clone(), MentionExtractor::PathLike));
        }
        if has_source_extension(&clean) {
            out.push((clean.clone(), MentionExtractor::Extension));
        }
        // Without an index there is nothing to resolve an identifier against,
        // so the extractor is switched off rather than producing noise.
        if has_index && looks_like_identifier(&clean) {
            out.push((clean, MentionExtractor::Identifier));
        }
    }
    out
}

/// Drop example fences and URLs; neutralise the remaining fence markers so a
/// triple backtick cannot pair with an inline one.
fn preprocess(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut inside_dropped = false;
    let mut inside_kept = false;

    for line in text.lines() {
        let trimmed = line.trim_start();
        if let Some(info) = trimmed.strip_prefix("```") {
            let info = info.trim().to_ascii_lowercase();
            if inside_dropped {
                inside_dropped = false;
            } else if inside_kept {
                inside_kept = false;
            } else if EXAMPLE_FENCES.contains(&info.as_str()) {
                inside_dropped = true;
            } else {
                inside_kept = true;
            }
            continue;
        }
        if inside_dropped {
            continue;
        }
        out.push_str(&strip_urls(line));
        out.push('\n');
    }
    out
}

fn strip_urls(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    loop {
        let hit = ["http://", "https://"]
            .iter()
            .filter_map(|scheme| rest.find(scheme))
            .min();
        let Some(start) = hit else {
            out.push_str(rest);
            return out;
        };
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        match tail.find(char::is_whitespace) {
            Some(end) => rest = &tail[end..],
            None => return out,
        }
    }
}

fn clean_token(token: &str) -> Option<String> {
    let trimmed = token
        .trim_start_matches(['(', '[', '{', '"', '\'', '<'])
        .trim_end_matches(['.', ',', ';', ':', '!', '?', ')', ']', '}', '"', '\'', '>']);
    let stripped = strip_line_suffix(trimmed);
    (!stripped.is_empty()).then(|| stripped.to_string())
}

/// `src/a.ts:38` and `src/a.ts:22-28` name a file, not a file called `a.ts:38`.
/// Agents cite line ranges constantly, so this is the difference between an
/// anchor resolving and being thrown away.
fn strip_line_suffix(token: &str) -> &str {
    let Some((head, tail)) = token.rsplit_once(':') else {
        return token;
    };
    let is_line_range = !tail.is_empty()
        && tail
            .split('-')
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()));
    if is_line_range && !head.is_empty() {
        head
    } else {
        token
    }
}

fn looks_like_path(token: &str) -> bool {
    if !token.contains('/') {
        return false;
    }
    let segments: Vec<&str> = token.split('/').filter(|s| !s.is_empty()).collect();
    segments.len() >= 2
        && segments.iter().all(|segment| {
            segment
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '@' | '-' | '*'))
        })
}

fn has_source_extension(token: &str) -> bool {
    token
        .rsplit_once('.')
        .is_some_and(|(stem, ext)| !stem.is_empty() && SOURCE_EXTENSIONS.contains(&ext))
}

/// snake_case with at least two lowercase segments, or CamelCase with at least
/// two internal case boundaries — `SessionSummary` and `resolveSessionToken`
/// both qualify, `Login` and `refactor` do not.
///
/// Anything looser starts matching ordinary English words, and a word that
/// happens to name a symbol would silently narrow the prompt's scope to
/// wherever that symbol lives.
fn looks_like_identifier(token: &str) -> bool {
    if !token.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return false;
    }
    if token.contains('_') {
        let segments: Vec<&str> = token.split('_').filter(|s| !s.is_empty()).collect();
        return segments.len() >= 2 && !token.chars().any(|c| c.is_ascii_uppercase());
    }
    // At least one lowercase run keeps acronyms (`HTTP`, `API`) out; two
    // uppercase letters keep single-capital words (`Login`) out.
    token.chars().filter(char::is_ascii_uppercase).count() >= 2
        && token.chars().any(|c| c.is_ascii_lowercase())
}

/// Stage B — applied **before** resolution, deliberately.
fn reject(token: &str) -> bool {
    if token.chars().count() <= 2 || token.starts_with('$') {
        return true;
    }
    if STOPWORDS.contains(&token.to_ascii_lowercase().as_str()) {
        return true;
    }
    // `26/26`, `45/45` — progress counters an agent printed, not paths.
    if token.contains('/')
        && token
            .split('/')
            .filter(|segment| !segment.is_empty())
            .all(|segment| segment.chars().all(|c| c.is_ascii_digit()))
    {
        return true;
    }
    is_version_like(token)
}

fn is_version_like(token: &str) -> bool {
    let core = token.strip_prefix('v').unwrap_or(token);
    let core = core.split('-').next().unwrap_or(core);
    !core.is_empty()
        && core
            .split('.')
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
}

/// Stage C — first hit wins; anything ambiguous stays unresolved.
fn resolve(
    raw: &str,
    extractor: MentionExtractor,
    input: &DriftInput<'_>,
) -> Option<ResolvedAnchor> {
    let candidate = raw.trim_end_matches('/');

    if let Some(anchor) = resolve_literal(candidate, input.anchors) {
        return Some(anchor);
    }
    for expanded in expand_aliases(candidate, input.anchors) {
        if let Some(anchor) = resolve_literal(&expanded, input.anchors) {
            return Some(anchor);
        }
    }
    if let Some(anchor) = resolve_suffix(candidate, input.anchors) {
        return Some(anchor);
    }
    if let Some(path) = unique_basename(candidate, input.anchors) {
        return Some(ResolvedAnchor {
            path,
            kind: AnchorKind::File,
        });
    }
    if extractor == MentionExtractor::Identifier {
        let definitions = input.index?.definitions_of(candidate);
        if definitions.len() == 1 {
            return Some(ResolvedAnchor {
                path: definitions[0].path.to_string(),
                kind: AnchorKind::SymbolDefinition,
            });
        }
    }
    None
}

fn resolve_literal(candidate: &str, anchors: &RepoAnchors) -> Option<ResolvedAnchor> {
    if anchors.files.contains(candidate) {
        return Some(ResolvedAnchor {
            path: candidate.to_string(),
            kind: AnchorKind::File,
        });
    }
    if anchors.dirs.contains(candidate) {
        return Some(ResolvedAnchor {
            path: format!("{}/", candidate),
            kind: AnchorKind::Directory,
        });
    }
    None
}

/// `@/x` → `src/x` (only when the tsconfig really maps it) and
/// `crate::a::b` → `src/a/b.rs` | `src/a/b/mod.rs`.
fn expand_aliases(candidate: &str, anchors: &RepoAnchors) -> Vec<String> {
    if let Some(rest) = candidate.strip_prefix("@/") {
        return match &anchors.path_alias {
            Some(root) => vec![format!("{}/{}", root, rest)],
            None => Vec::new(),
        };
    }
    if let Some(rest) = candidate.strip_prefix("crate::") {
        let path = rest.replace("::", "/");
        return vec![format!("src/{}.rs", path), format!("src/{}/mod.rs", path)];
    }
    Vec::new()
}

/// Resolve by walking the token's own segments from the longest tail inwards.
///
/// This is what makes real prompts work. Agents cite **absolute** paths
/// (`/Users/me/proj/src/api/verify.ts`), paths rooted in a sibling worktree,
/// and crate paths in a workspace whose crate root is not the repository root.
/// All three are the same shape: a token whose *tail* is a repository path.
///
/// Longest tail first, so `src/api/user.ts` beats `api/user.ts`, and a tail
/// matching more than one tracked file resolves to nothing rather than to a
/// guess (G4).
fn resolve_suffix(candidate: &str, anchors: &RepoAnchors) -> Option<ResolvedAnchor> {
    let segments: Vec<&str> = candidate.split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() < 2 {
        return None;
    }

    // Stop before the bare basename: a single segment is `unique_basename`'s
    // job, under stricter rules.
    for start in 0..segments.len() - 1 {
        let tail = segments[start..].join("/");
        if let Some(anchor) = resolve_literal(&tail, anchors) {
            return Some(anchor);
        }
        let needle = format!("/{}", tail);
        let mut hits = anchors.files.iter().filter(|file| file.ends_with(&needle));
        if let Some(first) = hits.next() {
            if hits.next().is_none() {
                return Some(ResolvedAnchor {
                    path: first.clone(),
                    kind: AnchorKind::File,
                });
            }
        }
    }
    None
}

/// Exactly one tracked file with this base name. Two or more is an ambiguity,
/// and a guess would narrow the scope to the wrong place.
fn unique_basename(candidate: &str, anchors: &RepoAnchors) -> Option<String> {
    if candidate.contains('/') {
        return None;
    }
    let mut hits = anchors
        .files
        .iter()
        .filter(|file| file.rsplit('/').next() == Some(candidate));
    let first = hits.next()?;
    hits.next().is_none().then(|| first.clone())
}

// ── Stage D ──────────────────────────────────────────────────────────────────

fn partition<'a>(
    anchors: &[&ResolvedAnchor],
    changed: &'a [ChangedPath],
) -> (Vec<String>, Vec<&'a ChangedPath>) {
    let mut in_scope: BTreeSet<String> = BTreeSet::new();

    for entry in changed {
        if directly_in_scope(&entry.path, anchors)
            || entry
                .renamed_from
                .as_deref()
                .is_some_and(|old| directly_in_scope(old, anchors))
            || is_side_effect(&entry.path)
        {
            in_scope.insert(entry.path.clone());
        }
    }

    // A test written for an in-scope file is part of that work, not a new area.
    let stems: BTreeSet<String> = in_scope
        .iter()
        .filter(|path| !is_test_path(path))
        .map(|path| base_stem(path))
        .chain(
            anchors
                .iter()
                .filter(|anchor| anchor.kind != AnchorKind::Directory)
                .map(|anchor| base_stem(&anchor.path)),
        )
        .collect();
    for entry in changed {
        if is_test_path(&entry.path) && stems.contains(&base_stem(&entry.path)) {
            in_scope.insert(entry.path.clone());
        }
    }

    let drifted = changed
        .iter()
        .filter(|entry| !in_scope.contains(&entry.path))
        .collect();
    (in_scope.into_iter().collect(), drifted)
}

fn directly_in_scope(path: &str, anchors: &[&ResolvedAnchor]) -> bool {
    anchors.iter().any(|anchor| match anchor.kind {
        AnchorKind::Directory => path.starts_with(&anchor.path),
        AnchorKind::File | AnchorKind::SymbolDefinition => path == anchor.path,
    })
}

fn is_side_effect(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    SIDE_EFFECT_FILES.contains(&name) || name.ends_with(".snap")
}

/// `src/a.test.ts` → `a`, `src/parser_test.rs` → `parser`, `src/a.ts` → `a`.
fn base_stem(path: &str) -> String {
    let name = path.trim_end_matches('/').rsplit('/').next().unwrap_or(path);
    let stem = name.split('.').next().unwrap_or(name);
    stem.trim_end_matches("_tests")
        .trim_end_matches("_test")
        .to_ascii_lowercase()
}

// ── Confidence ───────────────────────────────────────────────────────────────

fn grade(
    anchor_count: usize,
    coverage: f32,
    attribution: Option<LinkConfidence>,
) -> LinkConfidence {
    if anchor_count >= 2 && coverage >= 0.5 && attribution == Some(LinkConfidence::High) {
        return LinkConfidence::High;
    }
    if anchor_count >= 1 && coverage >= MIN_ANCHOR_COVERAGE {
        return LinkConfidence::Medium;
    }
    LinkConfidence::Low
}

fn downgrade(confidence: LinkConfidence) -> LinkConfidence {
    match confidence {
        LinkConfidence::High => LinkConfidence::Medium,
        LinkConfidence::Medium | LinkConfidence::Low => LinkConfidence::Low,
    }
}

fn unavailable(reason: Unavailable, basis: ImpactBasis) -> DriftSection {
    DriftSection {
        unavailable: Some(reason),
        mentions: Vec::new(),
        in_scope_paths: Vec::new(),
        drifted_paths: Vec::new(),
        drifted_total: 0,
        changed_total: 0,
        verdict: DriftVerdict::NoAnchor,
        confidence: LinkConfidence::Low,
        basis,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::context::index::fixture::index_from_sources;
    const TRACKED: &[&str] = &[
        "src/auth/login.ts",
        "src/auth/login.test.ts",
        "src/auth/session.ts",
        "src/billing/invoice.ts",
        "src/lib/utils.ts",
        "src/components/Button.tsx",
        "src-tauri/src/verify/report/drift.rs",
        "pnpm-lock.yaml",
        "docs/readme.md",
        "a/shared.ts",
        "b/shared.ts",
        "tsconfig.json",
    ];

    fn anchors() -> RepoAnchors {
        RepoAnchors::new(
            TRACKED.iter().map(|p| p.to_string()).collect(),
            Some("src".to_string()),
        )
    }

    use crate::verify::report::testutil::prompt;

    fn changed(paths: &[&str]) -> Vec<ChangedPath> {
        paths
            .iter()
            .map(|path| ChangedPath {
                path: path.to_string(),
                edit_count: 1,
                added_lines: Some(1),
                removed_lines: Some(0),
                renamed_from: None,
            })
            .collect()
    }

    fn run(prompts: &[PromptRecord], changed: &[ChangedPath]) -> DriftSection {
        run_with(prompts, changed, None, None, false)
    }

    fn run_with(
        prompts: &[PromptRecord],
        changed: &[ChangedPath],
        index: Option<&RepoIndex>,
        attribution: Option<LinkConfidence>,
        partial_log: bool,
    ) -> DriftSection {
        let anchors = anchors();
        build(&DriftInput {
            prompts,
            anchors: &anchors,
            index,
            changed,
            basis: ImpactBasis::AttributedCommitRange,
            attribution,
            partial_log,
        })
    }

    // ── G1: the guard the whole rule stands on ────────────────────────────

    #[test]
    fn a_korean_prompt_naming_no_path_produces_nothing_at_all() {
        let section = run(
            &[prompt(0, "로그인 리팩터링 해줘")],
            &changed(&["src/auth/login.ts", "src/billing/invoice.ts"]),
        );
        assert_eq!(
            section.unavailable.expect("reason").reason,
            UnavailableReason::NoResolvableAnchor
        );
        assert!(section.drifted_paths.is_empty());
        assert_eq!(section.verdict, DriftVerdict::NoAnchor);
    }

    #[test]
    fn an_english_prompt_naming_no_path_produces_nothing_at_all() {
        let section = run(
            &[prompt(0, "please refactor the login flow and clean it up")],
            &changed(&["src/auth/login.ts", "src/billing/invoice.ts"]),
        );
        assert_eq!(
            section.unavailable.expect("reason").reason,
            UnavailableReason::NoResolvableAnchor
        );
    }

    #[test]
    fn a_prompt_of_nothing_but_stopwords_resolves_to_nothing() {
        for text in ["테스트 고쳐줘", "fix the tests", "run the build", "fix src"] {
            let section = run(&[prompt(0, text)], &changed(&["src/auth/login.ts"]));
            assert_eq!(
                section.unavailable.expect("reason").reason,
                UnavailableReason::NoResolvableAnchor,
                "{text} must not narrow scope"
            );
        }
    }

    // ── Named and respected / named and violated ──────────────────────────

    #[test]
    fn a_backticked_path_that_was_the_only_thing_changed_is_within_scope() {
        let section = run(
            &[prompt(0, "`src/auth/login.ts` 파일 리팩터링 해줘")],
            &changed(&["src/auth/login.ts"]),
        );
        assert!(section.unavailable.is_none());
        assert_eq!(section.verdict, DriftVerdict::WithinScope);
        assert_eq!(section.in_scope_paths, vec!["src/auth/login.ts".to_string()]);
        assert!(section.drifted_paths.is_empty());
    }

    #[test]
    fn a_backticked_path_that_never_changed_is_full_drift() {
        let section = run(
            &[prompt(0, "refactor `src/auth/login.ts` please")],
            &changed(&["src/billing/invoice.ts", "docs/readme.md"]),
        );
        assert_eq!(section.verdict, DriftVerdict::FullDrift);
        assert_eq!(section.drifted_total, 2);
        assert_eq!(section.in_scope_paths.len(), 0);
    }

    #[test]
    fn a_directory_mention_covers_everything_beneath_it() {
        let section = run(
            &[prompt(0, "clean up `src/auth` a bit")],
            &changed(&["src/auth/login.ts", "src/auth/session.ts"]),
        );
        assert_eq!(section.verdict, DriftVerdict::WithinScope);
    }

    #[test]
    fn a_bare_path_without_backticks_still_resolves() {
        let section = run(
            &[prompt(0, "src/billing/invoice.ts 를 고쳐줘.")],
            &changed(&["src/billing/invoice.ts"]),
        );
        assert_eq!(section.verdict, DriftVerdict::WithinScope);
        assert_eq!(section.mentions[0].extractor, MentionExtractor::Backtick.min(MentionExtractor::PathLike));
    }

    #[test]
    fn an_extension_only_mention_resolves_through_a_unique_basename() {
        let section = run(
            &[prompt(0, "invoice.ts 만 손봐줘")],
            &changed(&["src/billing/invoice.ts"]),
        );
        assert_eq!(section.verdict, DriftVerdict::WithinScope);
        assert_eq!(
            section.mentions[0].resolved.as_ref().expect("resolved").path,
            "src/billing/invoice.ts"
        );
    }

    #[test]
    fn a_basename_living_in_two_places_stays_unresolved() {
        let section = run(
            &[prompt(0, "shared.ts 고쳐줘")],
            &changed(&["a/shared.ts", "b/shared.ts"]),
        );
        assert_eq!(
            section.unavailable.expect("reason").reason,
            UnavailableReason::NoResolvableAnchor,
            "a guess would narrow the scope to the wrong file"
        );
    }

    // ── Guards ────────────────────────────────────────────────────────────

    #[test]
    fn a_follow_up_prompt_contributes_its_own_anchor() {
        let section = run(
            &[
                prompt(0, "refactor `src/auth/login.ts`"),
                prompt(1, "그리고 `src/billing/invoice.ts` 도 고쳐줘"),
            ],
            &changed(&["src/auth/login.ts", "src/billing/invoice.ts"]),
        );
        assert_eq!(
            section.verdict,
            DriftVerdict::WithinScope,
            "G3: every prompt names scope, not only the first"
        );
    }

    #[test]
    fn lockfiles_and_snapshots_are_consequences_not_drift() {
        let section = run(
            &[prompt(0, "refactor `src/auth/login.ts`")],
            &changed(&["src/auth/login.ts", "pnpm-lock.yaml", "src/a.snap"]),
        );
        assert_eq!(section.verdict, DriftVerdict::WithinScope);
    }

    #[test]
    fn the_test_partner_of_an_in_scope_file_is_in_scope() {
        let section = run(
            &[prompt(0, "refactor `src/auth/login.ts`")],
            &changed(&["src/auth/login.ts", "src/auth/login.test.ts"]),
        );
        assert_eq!(section.verdict, DriftVerdict::WithinScope);
    }

    #[test]
    fn a_renamed_in_scope_file_is_not_drift_on_its_new_path() {
        let mut entries = changed(&["src/auth/renamed.ts"]);
        entries[0].renamed_from = Some("src/auth/login.ts".to_string());
        let section = run(&[prompt(0, "move `src/auth/login.ts`")], &entries);
        assert_eq!(section.verdict, DriftVerdict::WithinScope);
    }

    #[test]
    fn a_shell_example_in_the_prompt_is_not_an_instruction() {
        let section = run(
            &[prompt(
                0,
                "이렇게 돌렸어:\n```bash\nvitest run src/billing/invoice.ts\n```\n`src/auth/login.ts` 를 고쳐줘",
            )],
            &changed(&["src/auth/login.ts"]),
        );
        assert_eq!(section.verdict, DriftVerdict::WithinScope);
        assert!(
            section
                .mentions
                .iter()
                .all(|m| m.raw != "src/billing/invoice.ts"),
            "a path inside a shell snippet is not a request: {:?}",
            section.mentions
        );
    }

    #[test]
    fn urls_never_become_anchors() {
        let section = run(
            &[prompt(
                0,
                "see https://example.com/src/auth/login.ts and fix `src/billing/invoice.ts`",
            )],
            &changed(&["src/billing/invoice.ts"]),
        );
        assert_eq!(section.verdict, DriftVerdict::WithinScope);
        assert_eq!(section.mentions.len(), 1);
    }

    #[test]
    fn a_glob_like_mention_that_matches_nothing_is_displayed_but_narrows_nothing() {
        let section = run(
            &[prompt(0, "`src/auth/*.ts` 전부 고쳐줘")],
            &changed(&["src/auth/login.ts"]),
        );
        // The glob itself does not resolve, so G1 applies: no anchor, no drift.
        assert_eq!(
            section.unavailable.expect("reason").reason,
            UnavailableReason::NoResolvableAnchor
        );
        assert_eq!(section.mentions.len(), 1, "the mention is still shown");
        assert!(section.mentions[0].resolved.is_none());
    }

    #[test]
    fn a_truncated_log_can_never_produce_full_drift() {
        let section = run_with(
            &[prompt(0, "refactor `src/auth/login.ts`")],
            &changed(&["src/billing/invoice.ts"]),
            None,
            None,
            true,
        );
        assert_eq!(
            section.verdict,
            DriftVerdict::PartialDrift,
            "G7: the anchor may have been in the tail we never read"
        );
        assert_eq!(section.confidence, LinkConfidence::Low);
    }

    #[test]
    fn thin_coverage_is_reported_at_low_confidence() {
        // One named path among ten changed ones: the prompt mentioned it, but
        // it explains almost nothing about what the session actually did.
        let mut entries = changed(&["src/auth/login.ts"]);
        entries.extend((0..9).map(|i| ChangedPath {
            path: format!("src/billing/part{i}.ts"),
            edit_count: 1,
            added_lines: None,
            removed_lines: None,
            renamed_from: None,
        }));

        let section = run(&[prompt(0, "refactor `src/auth/login.ts`")], &entries);
        assert_eq!(section.verdict, DriftVerdict::PartialDrift);
        assert_eq!(section.confidence, LinkConfidence::Low, "G2");
    }

    #[test]
    fn high_confidence_needs_two_anchors_half_the_paths_and_a_high_attribution() {
        let section = run_with(
            &[prompt(
                0,
                "fix `src/auth/login.ts` and `src/billing/invoice.ts`",
            )],
            &changed(&[
                "src/auth/login.ts",
                "src/billing/invoice.ts",
                "docs/readme.md",
            ]),
            None,
            Some(LinkConfidence::High),
            false,
        );
        assert_eq!(section.verdict, DriftVerdict::PartialDrift);
        assert_eq!(section.confidence, LinkConfidence::High);
    }

    #[test]
    fn a_worktree_baseline_costs_one_notch_of_confidence() {
        let anchors = anchors();
        let prompts = [prompt(0, "fix `src/auth/login.ts`")];
        let entries = changed(&["src/auth/login.ts", "docs/readme.md"]);
        let section = build(&DriftInput {
            prompts: &prompts,
            anchors: &anchors,
            index: None,
            changed: &entries,
            basis: ImpactBasis::WorktreeFallback,
            attribution: None,
            partial_log: false,
        });
        assert_eq!(section.confidence, LinkConfidence::Low);
    }

    // ── Identifier extractor ──────────────────────────────────────────────

    #[test]
    fn identifiers_resolve_only_when_a_symbol_index_exists() {
        let index = index_from_sources(&[(
            "src/auth/session.ts",
            "export function resolveSessionToken(id: string) { return id; }",
        )]);
        let prompts = [prompt(0, "resolveSessionToken 동작이 이상해, 고쳐줘")];
        let entries = changed(&["src/auth/session.ts"]);

        let without = run_with(&prompts, &entries, None, None, false);
        assert_eq!(
            without.unavailable.expect("reason").reason,
            UnavailableReason::NoResolvableAnchor,
            "with no index there is nothing to resolve an identifier against"
        );

        let with = run_with(&prompts, &entries, Some(&index), None, false);
        assert!(with.unavailable.is_none());
        assert_eq!(with.verdict, DriftVerdict::WithinScope);
        assert_eq!(
            with.mentions[0].resolved.as_ref().expect("resolved").kind,
            AnchorKind::SymbolDefinition
        );
    }

    // ── Findings ──────────────────────────────────────────────────────────

    #[test]
    fn a_finding_carries_a_number_and_a_path_and_no_judgement() {
        let section = run(
            &[prompt(0, "refactor `src/auth/login.ts`")],
            &changed(&["src/auth/login.ts", "src/billing/invoice.ts"]),
        );
        let findings = findings(&section);
        assert_eq!(findings.len(), 1);
        let finding = &findings[0];
        assert_eq!(finding.rule_id, "v26.promptScopeDrift");
        assert!(finding.message.contains('1') && finding.message.contains('2'));
        assert_eq!(
            finding.detail.as_deref(),
            Some("src/billing/invoice.ts")
        );
        for word in ["wrong", "violation", "should", "잘못", "위반", "실패"] {
            assert!(
                !finding.message.contains(word),
                "the rule states facts, it does not judge: {}",
                finding.message
            );
        }
    }

    #[test]
    fn no_anchor_and_within_scope_produce_no_finding() {
        assert!(findings(&run(
            &[prompt(0, "로그인 고쳐줘")],
            &changed(&["src/auth/login.ts"])
        ))
        .is_empty());
        assert!(findings(&run(
            &[prompt(0, "fix `src/auth/login.ts`")],
            &changed(&["src/auth/login.ts"])
        ))
        .is_empty());
    }

    // ── Unit-level helpers ────────────────────────────────────────────────

    #[test]
    fn version_strings_are_never_anchors() {
        for token in ["v2", "1.2.3", "2.0.0-rc1", "42"] {
            assert!(reject(token), "{token} must be rejected");
        }
        assert!(!reject("login.ts"));
    }

    #[test]
    fn identifier_shapes_are_narrow_enough_to_miss_ordinary_words() {
        assert!(looks_like_identifier("SessionSummary"));
        assert!(looks_like_identifier("resolveSessionToken"));
        assert!(looks_like_identifier("run_diff_rules"));
        assert!(!looks_like_identifier("login"));
        assert!(!looks_like_identifier("Login"));
        assert!(!looks_like_identifier("refactor"));
        assert!(!looks_like_identifier("HTTP"));
        assert!(!looks_like_identifier("한글단어"));
    }

    #[test]
    fn base_stems_pair_a_test_with_its_subject() {
        assert_eq!(base_stem("src/a/login.ts"), "login");
        assert_eq!(base_stem("src/a/login.test.ts"), "login");
        assert_eq!(base_stem("src/__tests__/login.ts"), "login");
        assert_eq!(base_stem("src/parser_test.rs"), "parser");
    }

    // ── Shapes real prompts actually contain ──────────────────────────────

    #[test]
    fn an_absolute_path_resolves_through_its_repository_relative_tail() {
        // Agents cite absolute paths constantly; before this, every one of them
        // was thrown away and the section fell back to "no anchor".
        let section = run(
            &[prompt(
                0,
                "`/Users/yj/Documents/private/GitBaro/src/auth/login.ts` 를 고쳐줘",
            )],
            &changed(&["src/auth/login.ts"]),
        );
        assert_eq!(section.verdict, DriftVerdict::WithinScope);
        assert_eq!(
            section.mentions[0].resolved.as_ref().expect("resolved").path,
            "src/auth/login.ts"
        );
    }

    #[test]
    fn a_line_reference_still_names_the_file() {
        for raw in [
            "`src/auth/login.ts:38`",
            "`src/auth/login.ts:22-28`",
            "`/tmp/proj/src/auth/login.ts:9`",
        ] {
            let section = run(&[prompt(0, raw)], &changed(&["src/auth/login.ts"]));
            assert_eq!(
                section.verdict,
                DriftVerdict::WithinScope,
                "{raw} should resolve to the file it cites"
            );
        }
    }

    #[test]
    fn class_names_and_flags_never_reach_the_mention_list() {
        let section = run(
            &[prompt(
                0,
                "`bg-muted` 와 `inline-flex` 를 `border-primary` 로 바꾸고 `--noEmit` 도 확인해줘, `src/auth/login.ts` 에서",
            )],
            &changed(&["src/auth/login.ts"]),
        );
        let shown: Vec<&str> = section.mentions.iter().map(|m| m.raw.as_str()).collect();
        assert_eq!(
            shown,
            vec!["src/auth/login.ts"],
            "unresolved non-paths are noise, not evidence"
        );
    }

    #[test]
    fn prose_alternations_are_not_paths() {
        // Observed verbatim in real prompts. None of them resolve, so they
        // never affected a verdict — but a list of them is exactly the
        // "vague pile of information" this rewrite exists to end.
        let section = run(
            &[prompt(
                0,
                "`JS/Rust` 둘 다에서 `pushed/unpushed` 를 `border-primary/40` 로, `src/auth/login.ts` 안에서",
            )],
            &changed(&["src/auth/login.ts"]),
        );
        let shown: Vec<&str> = section.mentions.iter().map(|m| m.raw.as_str()).collect();
        assert_eq!(shown, vec!["src/auth/login.ts"]);
    }

    #[test]
    fn resolved_anchors_always_survive_the_mention_cap() {
        let mut text = String::from("`src/auth/login.ts` 고쳐줘");
        for i in 0..MAX_PROMPT_MENTIONS + 10 {
            text.push_str(&format!(" `a/b/c{i}/d.ts`"));
        }
        let section = run(&[prompt(0, &text)], &changed(&["src/auth/login.ts"]));
        assert_eq!(section.mentions.len(), MAX_PROMPT_MENTIONS);
        assert!(section.mentions[0].resolved.is_some());
        assert_eq!(section.verdict, DriftVerdict::WithinScope);
    }

    #[test]
    fn progress_counters_are_not_paths() {
        for token in ["26/26", "45/45", "3/10"] {
            assert!(reject(token), "{token} is a counter, not a path");
        }
    }

    #[test]
    fn a_tail_matching_two_tracked_files_resolves_to_neither() {
        let section = run(
            &[prompt(0, "`/elsewhere/proj/shared.ts` 고쳐줘")],
            &changed(&["a/shared.ts"]),
        );
        assert_eq!(
            section.unavailable.expect("reason").reason,
            UnavailableReason::NoResolvableAnchor
        );
    }

    #[test]
    fn crate_paths_expand_to_a_rust_module_file() {
        let anchors = anchors();
        let expanded = expand_aliases("crate::verify::report::drift", &anchors);
        assert_eq!(
            expanded,
            vec![
                "src/verify/report/drift.rs".to_string(),
                "src/verify/report/drift/mod.rs".to_string()
            ]
        );
        // The crate root is not the repository root here, so the tail walk is
        // what actually lands it.
        assert_eq!(
            resolve_suffix("src/verify/report/drift.rs", &anchors)
                .expect("resolved")
                .path,
            "src-tauri/src/verify/report/drift.rs"
        );
    }

    #[test]
    fn the_at_alias_only_expands_when_the_tsconfig_declares_it() {
        let declared = anchors();
        assert_eq!(
            expand_aliases("@/auth/login.ts", &declared),
            vec!["src/auth/login.ts".to_string()]
        );
        let undeclared = RepoAnchors::new(declared.files.clone(), None);
        assert!(expand_aliases("@/auth/login.ts", &undeclared).is_empty());
    }
}
