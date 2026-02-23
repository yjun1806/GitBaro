pub use crate::git::engine::StashEntry;

/// Format a stash reference string by index (e.g. "stash@{0}").
pub fn stash_ref(index: usize) -> String {
    format!("stash@{{{}}}", index)
}

/// Extract a short summary from a stash message.
/// git stash messages look like "On branch: WIP on main: abc1234 subject"
pub fn stash_short_message(message: &str) -> &str {
    // Try to strip the "WIP on <branch>: " prefix git adds automatically.
    if let Some(pos) = message.find(": ") {
        let after = &message[pos + 2..];
        // Skip the commit-hash prefix if present (7-char hex followed by space).
        if after.len() > 8 {
            let maybe_hash = &after[..7];
            if maybe_hash.chars().all(|c| c.is_ascii_hexdigit()) && after.as_bytes().get(7) == Some(&b' ') {
                return &after[8..];
            }
        }
        return after;
    }
    message
}
