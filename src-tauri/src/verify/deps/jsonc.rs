//! `tsconfig.json` is JSONC, not JSON: it may carry `//` and `/* */` comments
//! and trailing commas, all of which `serde_json` rejects. Stripping them here
//! keeps V4 from losing `compilerOptions.paths` — and losing those turns every
//! aliased import (`@/lib/foo`) into a false "hallucinated package".

/// Remove comments and trailing commas so the result parses as strict JSON.
pub fn strip_jsonc(input: &str) -> String {
    drop_trailing_commas(&drop_comments(input))
}

fn drop_comments(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;

    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }

        match c {
            '"' => {
                in_string = true;
                out.push(c);
            }
            '/' if chars.peek() == Some(&'/') => {
                for skipped in chars.by_ref() {
                    if skipped == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut previous = '\0';
                for skipped in chars.by_ref() {
                    if previous == '*' && skipped == '/' {
                        break;
                    }
                    previous = skipped;
                }
            }
            _ => out.push(c),
        }
    }

    out
}

fn drop_trailing_commas(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes: Vec<char> = input.chars().collect();
    let mut in_string = false;
    let mut escaped = false;

    for (index, &c) in bytes.iter().enumerate() {
        if in_string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        if c == '"' {
            in_string = true;
            out.push(c);
            continue;
        }
        if c == ',' {
            let next = bytes[index + 1..].iter().find(|n| !n.is_whitespace());
            if matches!(next, Some('}') | Some(']')) {
                continue;
            }
        }
        out.push(c);
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_and_block_comments_are_removed() {
        let source = r#"{
            // a line comment
            "a": 1, /* inline */
            "b": 2
        }"#;
        let value: serde_json::Value =
            serde_json::from_str(&strip_jsonc(source)).expect("strict json");
        assert_eq!(value["a"], 1);
        assert_eq!(value["b"], 2);
    }

    #[test]
    fn trailing_commas_are_removed() {
        let source = "{ \"a\": [1, 2,], \"b\": 3, }";
        let value: serde_json::Value =
            serde_json::from_str(&strip_jsonc(source)).expect("strict json");
        assert_eq!(value["a"][1], 2);
        assert_eq!(value["b"], 3);
    }

    #[test]
    fn comment_markers_inside_strings_survive() {
        let source = r#"{ "url": "https://example.com/x", "glob": "a/*", "esc": "say \" // hi" }"#;
        let value: serde_json::Value =
            serde_json::from_str(&strip_jsonc(source)).expect("strict json");
        assert_eq!(value["url"], "https://example.com/x");
        assert_eq!(value["glob"], "a/*");
        assert_eq!(value["esc"], "say \" // hi");
    }
}
