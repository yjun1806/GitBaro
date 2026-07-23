// commit-and-tag-version updater for src-tauri/Cargo.lock.
// Bumps only the `gitbaro` crate's own entry, leaving every dependency untouched.
// Cargo.lock lists each package as `name = "..."` followed by `version = "..."`.
const GITBARO_VERSION_RE = /(name = "gitbaro"\r?\nversion = ")(.+?)(")/;

module.exports.readVersion = (contents) => {
  const match = contents.match(GITBARO_VERSION_RE);
  if (!match) {
    throw new Error('Cargo.lock: could not find the "gitbaro" package entry');
  }
  return match[2];
};

module.exports.writeVersion = (contents, version) =>
  contents.replace(GITBARO_VERSION_RE, `$1${version}$3`);
