// commit-and-tag-version updater for src-tauri/Cargo.toml.
// Bumps the `[package]` version only — the first line-anchored `version = "..."`,
// which is the crate's own version (dependency versions are inline, so they are
// never matched by the `^`-anchored pattern).
const VERSION_RE = /^version = "(.+?)"/m;

module.exports.readVersion = (contents) => {
  const match = contents.match(VERSION_RE);
  if (!match) {
    throw new Error("Cargo.toml: could not find `version = \"...\"` in [package]");
  }
  return match[1];
};

module.exports.writeVersion = (contents, version) =>
  contents.replace(VERSION_RE, `version = "${version}"`);
