# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [2.1.0](https://github.com/yjun1806/GitBaro/compare/v2.0.0...v2.1.0) (2026-09-27)


### Features

* **diff:** close the diff with a header button or Escape ([13456e1](https://github.com/yjun1806/GitBaro/commit/13456e1475f3ad2ec37ef6283d85f0192886e21d))
* **files:** open a file in the editor on double-click in every file list ([5045ea5](https://github.com/yjun1806/GitBaro/commit/5045ea5b85450da801d0fba37dbf519c7ad0b084))
* **graph:** draw every worktree as a lane in the repository step ([af5ddf0](https://github.com/yjun1806/GitBaro/commit/af5ddf099b012ace417779dfe2cac206c717c9b1))
* **graph:** name the regions, follow from the WIP row, trace the chain ([1c0a120](https://github.com/yjun1806/GitBaro/commit/1c0a120bd63807e2cbaa090e512fec7d49f56b44))
* **graph:** one +/− mark app-wide and a roomier narrow commit list ([2b1726f](https://github.com/yjun1806/GitBaro/commit/2b1726f9dcd082f4ad1eb42983c5e7ca8f62bff0))
* **graph:** show unpushed work apart from the remote and focus follow mode ([29f348e](https://github.com/yjun1806/GitBaro/commit/29f348e76ee984273919d38d19b1bd9defce1486))
* **graph:** split commit rows into five columns and drop the visible SHA ([33ae89f](https://github.com/yjun1806/GitBaro/commit/33ae89f8ad56e2896c789e58c848e5c1b8bf65a7))
* **history:** collapse commit info into a summary and share one scroll ([07fbbb7](https://github.com/yjun1806/GitBaro/commit/07fbbb7f0c40d20914e5cc905a9fafa4c96ac3cf))
* **layout:** keep a narrow commit list beside the file list and diff ([804fd73](https://github.com/yjun1806/GitBaro/commit/804fd7332f7a13c1545b2891d5f2f892229fb9c9))
* **layout:** move the git status line into a fixed footer status bar ([2470f31](https://github.com/yjun1806/GitBaro/commit/2470f31db06295f390ea4e014d5c3d3d98daec06))
* **layout:** resize the stacked panes with a drag handle ([1bdfb5f](https://github.com/yjun1806/GitBaro/commit/1bdfb5f87b7856048abc80ac18d4365a2a6f797d))
* **layout:** stack the graph, file list, and diff side by side ([f1ef458](https://github.com/yjun1806/GitBaro/commit/f1ef4582eae3f50ae3e06faa960c865de1851dcd))
* **live:** note an earlier edit by a different author on the follow line ([f223078](https://github.com/yjun1806/GitBaro/commit/f2230784ce6f6749005290588dd3bdeebf62055a))
* **live:** show a follow line above the diff while following ([bbe6b7b](https://github.com/yjun1806/GitBaro/commit/bbe6b7b572d30b891011bead85c99d4729d8adc5))
* **motion:** animate live edits and add a maximize-view context header ([089484e](https://github.com/yjun1806/GitBaro/commit/089484ebb80966e08b176f55de680236b0afe1ca))
* **review:** give the workspace step the same frame as the repository step ([cd7c372](https://github.com/yjun1806/GitBaro/commit/cd7c372eb65ee8a06a590b8819cf5831a39c7cf2))
* **review:** per-file view of unpushed work in the workspace ([cb77ebd](https://github.com/yjun1806/GitBaro/commit/cb77ebd351464da8801cfa23a539fef2891a0c80))
* **review:** read which unpushed commits touched each file ([405b441](https://github.com/yjun1806/GitBaro/commit/405b44193916fe831bdaf49c6ef4797096ab82b4))
* **scope:** add "this branch only" to the Actions and PR tabs ([8b1d55a](https://github.com/yjun1806/GitBaro/commit/8b1d55a56167a75ac37e9c7e1ec1e16aebdf1547))
* **scope:** add backend data for the workspace/repo/branch scope view ([406a24d](https://github.com/yjun1806/GitBaro/commit/406a24dd9ef1222f12ae9a9d5927fa851ec9ae04))
* **scope:** add the workspace/repo/branch scope model as pure functions ([fa35ed6](https://github.com/yjun1806/GitBaro/commit/fa35ed61532f164c32d7bf697b67878057d502d9))
* **scope:** keep the picked commit when moving between scope steps ([61c1401](https://github.com/yjun1806/GitBaro/commit/61c14013baba1a851743d5e6f05fd2270c54e741))
* **sidebar:** open the "repository" scope from the repository row ([c56a6c8](https://github.com/yjun1806/GitBaro/commit/c56a6c8da5eacae87133fa11ff50f6a601ac37ca))
* **sidebar:** show uncommitted, pull and push at a glance ([96f8997](https://github.com/yjun1806/GitBaro/commit/96f8997723d5b6f59215e845b86b18aca205ab9c))
* **sidebar:** show working branches under each repository ([5e08389](https://github.com/yjun1806/GitBaro/commit/5e08389d52a94ebd9fda08c5495c274969ee5647))
* **status-bar:** show a sentence per scope step (workspace/repo/branch) ([468567c](https://github.com/yjun1806/GitBaro/commit/468567cc8dc1a1ad507441cf8b49b5e3306be2a3))
* **toolbar:** move viewing a branch without checking it out into the path ([e52e54c](https://github.com/yjun1806/GitBaro/commit/e52e54cd0100987062f2281975a9f45d0e36eb30))
* **ui:** add shared filter primitives (FilterBar/FilterChip/FilterDropdown) ([ee9fc33](https://github.com/yjun1806/GitBaro/commit/ee9fc33523cdb765b2885c87ab19ee2367c896ba))
* **ui:** shared loading and motion rules, one ground for the window ([0f4c9e4](https://github.com/yjun1806/GitBaro/commit/0f4c9e4cdc66f4145155c285e3b3ec4154313add))
* **ui:** show a chevron on collapsible section labels ([e2d2d77](https://github.com/yjun1806/GitBaro/commit/e2d2d77542724d03d0b59249c43e823a699d9442))
* **worktree:** resolve a base created from HEAD via the HEAD reflogs ([9a21926](https://github.com/yjun1806/GitBaro/commit/9a21926a4c8ed07e08d8d91553c5a80f5e54cbc6))


### Bug Fixes

* **auth:** blame the GitHub sign-in only for github.com remotes ([65d07c9](https://github.com/yjun1806/GitBaro/commit/65d07c9e24a9955dae5df9323c286a1274dd963b))
* **git:** stop inherited git settings from blocking account credentials ([293c065](https://github.com/yjun1806/GitBaro/commit/293c065eccd21ec69b7008b9a9fc0aaf49f0d6c4))
* **graph:** give the uncommitted row room and say its time once ([19afd87](https://github.com/yjun1806/GitBaro/commit/19afd872743cde12c4510d07b8662ca89a01baf2))
* **graph:** keep the remote boundary honest and stop double counts ([dfe4885](https://github.com/yjun1806/GitBaro/commit/dfe4885609c650b5d93b3ec7fc9e45c7561cb499))
* **graph:** keep the unpushed range pane in step with the graph ([2424659](https://github.com/yjun1806/GitBaro/commit/242465969630a9214fc11f3ba0ffb3e8e0cc92bd))
* **graph:** show branch labels on commit rows in full when there is room ([048aba4](https://github.com/yjun1806/GitBaro/commit/048aba43e183293aff315f1f12f9690c4f1cccf1))
* **graph:** tell local, remote and HEAD branch labels apart again ([5c7f536](https://github.com/yjun1806/GitBaro/commit/5c7f5362ce24d46610635b93cf259caca449c3eb))
* **graph:** tidy region labels, chip counts and the change column ([960e024](https://github.com/yjun1806/GitBaro/commit/960e02430e1a9a795f573352f675b785c04ae632))
* **layout:** calm the stacked-pane transitions ([7d56b8f](https://github.com/yjun1806/GitBaro/commit/7d56b8fe06910e047052c3e607955b6fbadb4c97))
* **layout:** give the graph the full width until there is something to show beside it ([3b74068](https://github.com/yjun1806/GitBaro/commit/3b74068c7975e750405ad7c5dd14f69758472885))
* **layout:** one 8px gutter on both sides of the sidebar line ([c4cbaa5](https://github.com/yjun1806/GitBaro/commit/c4cbaa5586fc185f5b0d9a2910e6f0808956bc15))
* **review:** base the per-file view on what push would change ([1b6bcaf](https://github.com/yjun1806/GitBaro/commit/1b6bcaffd14b7ddc501b847eb420165c38d53370))
* **scope:** count unpushed commits on an unchecked branch exactly ([e782640](https://github.com/yjun1806/GitBaro/commit/e78264038bffe566823e16dcb26f7ec2214fd731))
* **settings:** show a saved setting in the sidebar right away ([f275451](https://github.com/yjun1806/GitBaro/commit/f275451cb2bd8a1891b08b667c1f46e510693de0))
* **theme:** give unpushed commit rows a faint blue-gray, not the canvas gray ([5a4ed5f](https://github.com/yjun1806/GitBaro/commit/5a4ed5fb775a860b7a4c50f120b2b4a32d3884eb)), closes [#f2f2f0](https://github.com/yjun1806/GitBaro/issues/f2f2f0) [#f1f1](https://github.com/yjun1806/GitBaro/issues/f1f1) [#f3f6](https://github.com/yjun1806/GitBaro/issues/f3f6) [#242a32](https://github.com/yjun1806/GitBaro/issues/242a32)
* **toolbar:** keep the path card on one line at any width ([2f6c017](https://github.com/yjun1806/GitBaro/commit/2f6c0176675ecca86a70347003db1146824bab97))
* **ui:** keep the busy indicator steady through progress and refill flashes ([936519c](https://github.com/yjun1806/GitBaro/commit/936519c986aed5be098baef63c786b10b11617a0))
* **ui:** menus, dropdowns, disabled hints and search after the migration ([b83eaf3](https://github.com/yjun1806/GitBaro/commit/b83eaf3dcde5adfe818f0d8479da0308e204bdf6))


### Refactoring

* **graph:** drop the duplicate branch picker and unpushed-range view ([20aacb5](https://github.com/yjun1806/GitBaro/commit/20aacb507a14f1d6446b8d25caa244270bab6c27))
* **review:** drop the changes-vs-base tab for commit range reads ([600f2c0](https://github.com/yjun1806/GitBaro/commit/600f2c094ddc53fc5138c8b6fc58158ed67c4cc4))
* **ui:** apply the design system to graph, history, branch, worktree, commit and stash ([d2f83fa](https://github.com/yjun1806/GitBaro/commit/d2f83fa97f050cff02d1c2d46fb0b8d6b15c5182))
* **ui:** apply the design system to review, follow, diff, PR, actions and sidebar ([0cd9c14](https://github.com/yjun1806/GitBaro/commit/0cd9c14d86688ee72d6416d91153e42ee62a7489))
* **ui:** shared primitives and the design system for app chrome ([d6ce110](https://github.com/yjun1806/GitBaro/commit/d6ce1103f26bfd60cc4bc601884656ceb570ff53))


### Documentation

* add the scope-unify contract to the design system ([44a9f2e](https://github.com/yjun1806/GitBaro/commit/44a9f2e1674258ae73846a723f0750680ac12caf))
* **agents:** state that the app watches agent work, not approves it ([891ced8](https://github.com/yjun1806/GitBaro/commit/891ced8d51fa7bf63b178083020bc9ad8d52ac70))
* **design-system:** adopt stacked panes, short region labels, and the follow line ([5d02e8b](https://github.com/yjun1806/GitBaro/commit/5d02e8b582b36a1a76205da4a8282a29c994ed1f))
* **design-system:** note where the filter bar is used now ([3635756](https://github.com/yjun1806/GitBaro/commit/36357566a7fda87841f675aff2cc076d6b74e67c))
* **design-system:** record where commit row columns live and how they narrow ([57b0a3f](https://github.com/yjun1806/GitBaro/commit/57b0a3fd3dcddf6043eba605b1d0195e495d7074))
* **design:** add the design system guide and migration checklist ([92936ac](https://github.com/yjun1806/GitBaro/commit/92936ac4fab0e78d4ee7d18829929759f97b306b))
* **design:** describe the implemented primitives and one gutter ([4269ad5](https://github.com/yjun1806/GitBaro/commit/4269ad58104df331f64a4f24eb88f0046871123e))
* **design:** record the five open design decisions ([52a6b92](https://github.com/yjun1806/GitBaro/commit/52a6b9216946fe928f968a338ac4ee8846ab8d6a))
* **design:** restore guide edits lost to a stash ([60e7ab9](https://github.com/yjun1806/GitBaro/commit/60e7ab90ddb451c2ac6c8dc24e548d2b7331e70b))

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
