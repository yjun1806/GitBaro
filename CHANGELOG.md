# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [2.0.0](https://github.com/yjun1806/GitBaro/compare/v0.1.7...v2.0.0) (2026-09-25)

GitBaro 2.0 is rebuilt around one job: reviewing what coding agents changed across your repositories and worktrees. Every commit that is not on any remote is a review target.

### ⚠ BREAKING CHANGES

* The sidebar, header and main screen were redesigned. The old tab layout, the bottom status bar, the collapsed icon rail and hover-to-expand sidebar are gone; the sidebar is either shown or hidden (⌘\).
* The toolbar no longer has Merge and Stash buttons. Merge from the branch panel or a branch's right-click menu; stash from the Stash tab or the right-click menu of the uncommitted-changes row in the graph.
* Worktree preview and the old branch-compare view were removed. Use "view branch without checkout" and the range compare in the commit graph instead.

### Features

* **sidebar:** account › workspace › repository › worktree tree drawn as one card per repository or workspace, with one-line rows, an orange dot for uncommitted changes, ↑N for commits to push, a hover card with details, drag to reorder, sort menu and a view-only row for the default branch.
* **workspaces:** group related repositories of one GitHub account and review them together in one graph with a lane per repository.
* **header:** a path card (repository › folder › branch) that opens the worktree and branch panels, grouped Fetch · Pull · Push buttons with counts ("Push 3", "Publish 3"), and an "Open repository" card (editor, terminal, Finder, GitHub).
* **graph:** commit graph with one color per worktree, a "worktrees shown together" legend, uncommitted-changes rows per worktree, marks for commits not on any remote and a boundary at the first pushed commit.
* **review:** view any branch without checking it out; a git status line; "changes vs base" for the whole branch with a base picker and per-file "viewed" marks that clear when the file changes again; working changes and commit detail as an explicit switch.
* **live:** follow files as an agent edits them, with just-changed lines highlighted; activity watching across all registered repositories, including commits made outside the app.
* **diff:** find inside the diff (⌘F), open a file at a line in your editor, maximize the diff with an animated transition and a side file list.
* **menus:** right-click menus for sidebar rows, graph commits, branch and tag labels, worktree chips, file lists, diff lines, stashes, branches and Actions runs.
* **notifications:** macOS notifications for new commits from agents and for failed CI runs, with per-repository overrides.
* **pull requests:** a read-only PR tab with the list, description, checks, commits, changed files and review threads.
* **settings:** repository settings (display name, avatar color, GitHub account, sync mode, compare base, notifications) and a rebuilt app settings screen (default sync, diff view and code font size, quiet repositories, worktree location, environment info).
* **sync:** per-repository automatic fetch or fast-forward pull, with a per-repository plan shown before multi-repository Fetch · Pull · Push.
* **theme:** light theme with layered surfaces, raspberry brand color for emphasis, Pretendard for the interface and D2Coding for code.

### Bug Fixes

* **merge:** switching repositories or restarting no longer aborts a merge in progress.
* **staging:** staging and status now use the git CLI, so LFS filters, submodules, symlinks and sparse checkouts behave like git.
* **checkout:** checking out a remote branch whose local branch already exists no longer stashes your changes for nothing.
* **worktree:** removing the open worktree outside the app returns to the primary folder instead of showing every file as deleted.
* **push:** push and pull from the status line work inside linked worktrees.
* **diff:** fixed the diff viewer jittering while scrolling.
* **security:** PR descriptions and markdown diffs can no longer inject styles into the app.
* **storage:** upgrading keeps your repositories, favorites, accounts and workspaces; downgrading no longer wipes the repository list.

### Development

* ESLint 9 now runs, and a pre-commit hook checks types and lint. AGENTS.md is the single project guide (CLAUDE.md imports it).

## [0.1.7](https://github.com/yjun1806/GitBaro/compare/v0.1.6...v0.1.7) (2026-07-30)


### Bug Fixes

* **install:** keep the build cache out of the app's own cache directory ([5873997](https://github.com/yjun1806/GitBaro/commit/587399782e88c421be10496c817c193d52c3e945))
* **install:** stop the repo guard from matching a parent repository ([e32ce50](https://github.com/yjun1806/GitBaro/commit/e32ce50046d6a022c16d50c159dd83b599083116))
* **install:** survive macOS purging the build cache in $TMPDIR ([6a4ea27](https://github.com/yjun1806/GitBaro/commit/6a4ea2756c4036b009054bbd023a0c4e17800a3a))
* **repo:** count untracked files when marking a repository dirty ([a5ceff4](https://github.com/yjun1806/GitBaro/commit/a5ceff46386a3f714847fa641e6e308eda9a530e))
* **watch:** identify watchers by generation instead of path ([999b474](https://github.com/yjun1806/GitBaro/commit/999b474746b647ddb63b280fc47a1c92f3a753bf))
* **watch:** stop only the watcher for the path being torn down ([5dbf40b](https://github.com/yjun1806/GitBaro/commit/5dbf40bcfd47494dd93da2dd827d85d26188b7ed))
* **worktree:** show worktree state in the repository list ([ac17e43](https://github.com/yjun1806/GitBaro/commit/ac17e43db60ea8cd9e4649b3910fccadd665b39f))

## [0.1.6](https://github.com/yjun1806/GitBaro/compare/v0.1.5...v0.1.6) (2026-07-30)


### Bug Fixes

* **worktree:** keep the selected worktree when switching repositories ([4f1732f](https://github.com/yjun1806/GitBaro/commit/4f1732f9ec5e4ff9ad313d1a788cfe5e97b62376))

## [0.1.5](https://github.com/yjun1806/GitBaro/compare/v0.1.4...v0.1.5) (2026-07-27)


### Bug Fixes

* **storage:** keep a full localStorage from breaking every save ([bc0ef98](https://github.com/yjun1806/GitBaro/commit/bc0ef98809cbdf7f225f6ad676b3de6b9e1a11e2))

## [0.1.4](https://github.com/yjun1806/GitBaro/compare/v0.1.3...v0.1.4) (2026-07-27)


### Bug Fixes

* **diff:** position the overview ruler by measured height, not row count ([38434f7](https://github.com/yjun1806/GitBaro/commit/38434f7928de5d062ad8d69cf81ffd51495b3bf4))

## [0.1.3](https://github.com/yjun1806/GitBaro/compare/v0.1.2...v0.1.3) (2026-07-27)


### Features

* **diff:** let hunk headers expand the collapsed context around them ([bf20474](https://github.com/yjun1806/GitBaro/commit/bf2047410a055792cb9f0ec445a78ce5d61d47ad))
* **diff:** wrap long lines and show only the changed hunks ([2c05c0a](https://github.com/yjun1806/GitBaro/commit/2c05c0ad8eb83400211e32573de782203460c093))


### Bug Fixes

* **diff:** render raw HTML in markdown instead of escaping it ([359f8ef](https://github.com/yjun1806/GitBaro/commit/359f8efff2c7f590dc8a501d0d3448fe19a39bfb))
* **diff:** strip inline styles and form elements from rendered markdown ([61b82d7](https://github.com/yjun1806/GitBaro/commit/61b82d73bedb82f851a5403469013b0088d782d9))

## [0.1.2](https://github.com/yjun1806/GitBaro/compare/v0.1.1...v0.1.2) (2026-07-27)


### Features

* **diff:** add markdown document diff engine ([bd2f678](https://github.com/yjun1806/GitBaro/commit/bd2f67874b99d92d029b3666ef6691bf35ef6e8e))
* **diff:** show markdown files in a rendered document view by default ([e1c7333](https://github.com/yjun1806/GitBaro/commit/e1c7333393a1375a1bff68e3d991cabeef95955a))


### Performance

* **diff:** stop recomputing and rebuilding what the document view never uses ([404c790](https://github.com/yjun1806/GitBaro/commit/404c790ae98b9a38517482474c9ad819ff64ad44))

## [0.1.1](https://github.com/yjun1806/GitBaro/compare/v0.1.0...v0.1.1) (2026-07-24)


### Features

* **history:** push tags and surface their remote state ([dcb8618](https://github.com/yjun1806/GitBaro/commit/dcb8618f016224107be89438f8ac1e55297e46d0))
* **worktree:** split worktree management into a dedicated toolbar zone ([04ca461](https://github.com/yjun1806/GitBaro/commit/04ca4614eb7affa52cdf03f86b034613f34c49a4))


### Bug Fixes

* branch history/label correctness, loading feedback, faster listing ([0d53ff7](https://github.com/yjun1806/GitBaro/commit/0d53ff70c762d815c9dd0ec2b9eb8b7f5581ca8e))

## 0.1.0 (2026-07-23)

최초 릴리스.
