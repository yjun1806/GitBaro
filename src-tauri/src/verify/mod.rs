//! AI-output verification (contract §1).
//!
//! Five invariants govern everything below:
//!
//! 1. **Empty findings never mean "safe".** Every `VerificationReport` reports
//!    `checked` *and* `unchecked`; the registry must be fully accounted for.
//! 2. **No LLM re-query.** Every signal is deterministic static analysis, file
//!    parsing, or a real process result.
//! 3. **Session-log parse failure hides a feature, it is not an error.**
//! 4. **Session files are never fully loaded** — streaming under byte and wall
//!    clock budgets, with a summary cache.
//! 5. **Nothing blocks.** The push gate displays; it does not stop a push.
//!
//! This file declares the modules and re-exports the shared types. It holds no
//! logic of its own — see `types.rs` / `registry.rs` for the shared vocabulary.

pub mod config;
pub mod digest;
pub mod paths;
pub mod registry;
pub mod types;

pub mod bisect;
pub mod context;
pub mod deps;
pub mod evidence;
pub mod hooks;
pub mod hygiene;
pub mod review;
pub mod rules;
pub mod session;
pub mod structural;

pub use types::*;
