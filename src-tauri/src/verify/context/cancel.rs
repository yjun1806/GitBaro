// SPDX-License-Identifier: GPL-3.0-or-later
//! Cooperative cancellation for index builds (design §3.5).
//!
//! Cancellation is **not an error**. A cancelled build keeps everything it has
//! already parsed, reports `complete: false`, and returns `Ok`. Losing the work
//! would make cancelling worse than waiting, which teaches the user never to
//! cancel.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Clone, Default, Debug)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_token_is_not_cancelled() {
        assert!(!CancelToken::new().is_cancelled());
    }

    #[test]
    fn a_clone_observes_the_cancellation() {
        let token = CancelToken::new();
        let clone = token.clone();
        assert!(!clone.is_cancelled());
        token.cancel();
        assert!(clone.is_cancelled(), "clones share one flag");
    }

    #[test]
    fn cancellation_crosses_threads() {
        let token = CancelToken::new();
        let worker = token.clone();
        let handle = std::thread::spawn(move || {
            let mut seen = 0_u32;
            while !worker.is_cancelled() && seen < 10_000_000 {
                seen += 1;
            }
            seen
        });
        token.cancel();
        let seen = handle.join().expect("worker joins");
        assert!(seen < 10_000_000, "the worker stopped on the flag");
    }
}
