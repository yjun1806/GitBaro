//! 편집기를 특정 줄에서 여는 CLI 인자 만들기.
//!
//! 파일만 열 때는 `open -a <앱>`으로 충분하지만, 줄 번호는 각 편집기의 CLI에만 넘길 수 있다.
//! 앱에서 띄운 프로세스는 셸의 PATH를 모르므로 `code`·`subl` 같은 명령을 찾지 않고,
//! 앱 번들 안에 든 CLI를 직접 가리킨다. CLI를 못 찾으면 호출하는 쪽이 줄 없이 연다.
//!
//! 셸을 거치지 않고 인자를 하나씩 넘기며, 파일 경로는 호출하는 쪽이 정규화한 절대 경로다
//! (`/`로 시작하므로 옵션으로 읽힐 수 없다).

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// 편집기 CLI가 줄 번호를 받는 방식.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineSyntax {
    /// VS Code 계열: `--goto file:line[:column]`
    Goto,
    /// Zed, Sublime Text: `file:line[:column]`
    PathSuffix,
    /// JetBrains IDE: `--line N [--column C] file`
    JetBrains,
    /// Xcode(`xed`), TextMate(`mate`): `-l N file`
    DashL,
}

/// 줄 번호를 받는 편집기의 CLI 위치와 문법.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EditorCli {
    pub syntax: LineSyntax,
    /// `/`로 시작하면 절대 경로, 아니면 `Applications` 폴더 기준 앱 번들 안 경로.
    pub path: &'static str,
}

/// 편집기 ID에서 줄 번호를 넘길 CLI를 찾는다. 줄 번호 문법을 모르는 편집기는 `None`.
pub fn editor_cli(editor_id: &str) -> Option<EditorCli> {
    use LineSyntax::*;
    let (syntax, path) = match editor_id {
        "vscode" => (Goto, "Visual Studio Code.app/Contents/Resources/app/bin/code"),
        "cursor" => (Goto, "Cursor.app/Contents/Resources/app/bin/cursor"),
        "windsurf" => (Goto, "Windsurf.app/Contents/Resources/app/bin/windsurf"),
        "kiro" => (Goto, "Kiro.app/Contents/Resources/app/bin/kiro"),
        "antigravity" => (Goto, "Antigravity.app/Contents/Resources/app/bin/antigravity"),
        "zed" => (PathSuffix, "Zed.app/Contents/MacOS/cli"),
        "sublime" => (PathSuffix, "Sublime Text.app/Contents/SharedSupport/bin/subl"),
        "webstorm" => (JetBrains, "WebStorm.app/Contents/MacOS/webstorm"),
        "intellij" => (JetBrains, "IntelliJ IDEA.app/Contents/MacOS/idea"),
        "android_studio" => (JetBrains, "Android Studio.app/Contents/MacOS/studio"),
        "phpstorm" => (JetBrains, "PhpStorm.app/Contents/MacOS/phpstorm"),
        "rubymine" => (JetBrains, "RubyMine.app/Contents/MacOS/rubymine"),
        "goland" => (JetBrains, "GoLand.app/Contents/MacOS/goland"),
        "rider" => (JetBrains, "Rider.app/Contents/MacOS/rider"),
        "xcode" => (DashL, "/usr/bin/xed"),
        "textmate" => (DashL, "TextMate.app/Contents/SharedSupport/Support/bin/mate"),
        _ => return None,
    };
    Some(EditorCli { syntax, path })
}

/// CLI가 있을 수 있는 자리들. 앱 번들은 `/Applications`와 `~/Applications`(JetBrains Toolbox 등)를 본다.
pub fn cli_candidates(cli: &EditorCli, home: Option<&Path>) -> Vec<PathBuf> {
    if cli.path.starts_with('/') {
        return vec![PathBuf::from(cli.path)];
    }
    let mut out = vec![Path::new("/Applications").join(cli.path)];
    if let Some(home) = home {
        out.push(home.join("Applications").join(cli.path));
    }
    out
}

/// `file`의 `line`번 줄(1부터)을 여는 CLI 인자. `column`도 1부터 센다.
pub fn line_args(syntax: LineSyntax, file: &Path, line: u32, column: Option<u32>) -> Vec<OsString> {
    let column = column.filter(|c| *c > 0);
    let with_suffix = || {
        let mut s = file.as_os_str().to_os_string();
        s.push(format!(":{}", line));
        if let Some(c) = column {
            s.push(format!(":{}", c));
        }
        s
    };
    match syntax {
        LineSyntax::Goto => vec!["--goto".into(), with_suffix()],
        LineSyntax::PathSuffix => vec![with_suffix()],
        LineSyntax::JetBrains => {
            let mut args: Vec<OsString> = vec!["--line".into(), line.to_string().into()];
            if let Some(c) = column {
                args.push("--column".into());
                args.push(c.to_string().into());
            }
            args.push(file.into());
            args
        }
        LineSyntax::DashL => vec!["-l".into(), line.to_string().into(), file.into()],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strs(args: Vec<OsString>) -> Vec<String> {
        args.into_iter().map(|a| a.to_string_lossy().into_owned()).collect()
    }

    const FILE: &str = "/repo/src/a b.ts";

    #[test]
    fn vscode_family_uses_goto() {
        for id in ["vscode", "cursor", "windsurf", "kiro", "antigravity"] {
            let cli = editor_cli(id).unwrap();
            assert_eq!(cli.syntax, LineSyntax::Goto, "{id}");
            assert_eq!(strs(line_args(cli.syntax, Path::new(FILE), 12, None)), ["--goto", "/repo/src/a b.ts:12"]);
        }
        assert_eq!(
            strs(line_args(LineSyntax::Goto, Path::new(FILE), 12, Some(3))),
            ["--goto", "/repo/src/a b.ts:12:3"],
        );
    }

    #[test]
    fn zed_and_sublime_append_line_to_path() {
        for id in ["zed", "sublime"] {
            let cli = editor_cli(id).unwrap();
            assert_eq!(cli.syntax, LineSyntax::PathSuffix, "{id}");
            assert_eq!(strs(line_args(cli.syntax, Path::new(FILE), 7, None)), ["/repo/src/a b.ts:7"]);
        }
    }

    #[test]
    fn jetbrains_passes_line_flag_before_file() {
        for id in ["webstorm", "intellij", "android_studio", "phpstorm", "rubymine", "goland", "rider"] {
            assert_eq!(editor_cli(id).unwrap().syntax, LineSyntax::JetBrains, "{id}");
        }
        assert_eq!(
            strs(line_args(LineSyntax::JetBrains, Path::new(FILE), 40, None)),
            ["--line", "40", "/repo/src/a b.ts"],
        );
        assert_eq!(
            strs(line_args(LineSyntax::JetBrains, Path::new(FILE), 40, Some(2))),
            ["--line", "40", "--column", "2", "/repo/src/a b.ts"],
        );
    }

    #[test]
    fn xcode_and_textmate_use_dash_l() {
        let xed = editor_cli("xcode").unwrap();
        assert_eq!(xed, EditorCli { syntax: LineSyntax::DashL, path: "/usr/bin/xed" });
        assert_eq!(editor_cli("textmate").unwrap().syntax, LineSyntax::DashL);
        assert_eq!(strs(line_args(LineSyntax::DashL, Path::new(FILE), 5, Some(9))), ["-l", "5", "/repo/src/a b.ts"]);
    }

    #[test]
    fn column_zero_is_ignored() {
        assert_eq!(strs(line_args(LineSyntax::PathSuffix, Path::new(FILE), 3, Some(0))), ["/repo/src/a b.ts:3"]);
    }

    #[test]
    fn unknown_editors_have_no_line_cli() {
        for id in ["nova", "fleet", "", "rm -rf"] {
            assert!(editor_cli(id).is_none(), "{id}");
        }
    }

    #[test]
    fn a_path_that_looks_like_an_option_stays_one_argument() {
        // 경로는 정규화된 절대 경로만 오지만, 인자 하나로 넘어가는지도 확인해 둔다.
        let args = line_args(LineSyntax::Goto, Path::new("/r/--help; rm x"), 1, None);
        assert_eq!(strs(args), ["--goto", "/r/--help; rm x:1"]);
    }

    #[test]
    fn candidates_look_in_both_applications_folders() {
        let cli = editor_cli("zed").unwrap();
        assert_eq!(
            cli_candidates(&cli, Some(Path::new("/Users/me"))),
            [
                PathBuf::from("/Applications/Zed.app/Contents/MacOS/cli"),
                PathBuf::from("/Users/me/Applications/Zed.app/Contents/MacOS/cli"),
            ],
        );
        assert_eq!(cli_candidates(&editor_cli("xcode").unwrap(), Some(Path::new("/Users/me"))), [PathBuf::from("/usr/bin/xed")]);
    }
}
