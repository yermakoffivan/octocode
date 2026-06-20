#[derive(Clone, Copy)]
pub(super) struct StructuralQuery<'a> {
    pattern: Option<&'a str>,
    rule: Option<&'a str>,
}

impl<'a> StructuralQuery<'a> {
    pub(super) fn new(pattern: Option<&'a str>, rule: Option<&'a str>) -> Result<Self, String> {
        match (pattern, rule) {
            (Some(pattern), None) if pattern.trim().is_empty() => {
                Err("pattern must not be empty".to_string())
            }
            (None, Some(rule)) if rule.trim().is_empty() => {
                Err("rule must not be empty".to_string())
            }
            (Some(_), None) | (None, Some(_)) => Ok(Self { pattern, rule }),
            (Some(_), Some(_)) => Err("provide either `pattern` or `rule`, not both".to_string()),
            (None, None) => Err("structural search requires `pattern` or `rule`".to_string()),
        }
    }

    pub(super) fn parts(self) -> (Option<&'a str>, Option<&'a str>) {
        (self.pattern, self.rule)
    }

    pub(super) fn is_rule(self) -> bool {
        self.rule.is_some()
    }

    pub(super) fn literal_anchor(self) -> Option<&'a str> {
        match (self.pattern, self.rule) {
            (Some(pattern), _) => derive_literal_anchor(pattern),
            (_, Some(rule)) => derive_rule_anchor(rule),
            _ => None,
        }
    }
}

fn derive_literal_anchor(pattern: &str) -> Option<&str> {
    literal_anchor_candidates(pattern)
        .into_iter()
        .max_by_key(|token| {
            (
                token.chars().any(|ch| ch.is_ascii_alphanumeric()),
                token.len(),
            )
        })
}

fn literal_anchor_candidates(pattern: &str) -> Vec<&str> {
    let mut candidates = Vec::new();
    let mut token_start = None;
    let mut chars = pattern.char_indices().peekable();

    while let Some((index, ch)) = chars.next() {
        if ch == '$' {
            push_anchor_candidate(pattern, &mut candidates, &mut token_start, index);
            while let Some((_, next)) = chars.peek() {
                if *next == '$'
                    || *next == '_'
                    || next.is_ascii_uppercase()
                    || next.is_ascii_digit()
                {
                    chars.next();
                } else {
                    break;
                }
            }
            continue;
        }

        if is_anchor_char(ch) {
            token_start.get_or_insert(index);
        } else {
            push_anchor_candidate(pattern, &mut candidates, &mut token_start, index);
        }
    }

    push_anchor_candidate(pattern, &mut candidates, &mut token_start, pattern.len());
    candidates
}

fn push_anchor_candidate<'a>(
    pattern: &'a str,
    candidates: &mut Vec<&'a str>,
    token_start: &mut Option<usize>,
    end: usize,
) {
    let Some(start) = token_start.take() else {
        return;
    };
    let token = &pattern[start..end];
    if is_safe_anchor_token(token) {
        candidates.push(token);
    }
}

fn is_anchor_char(ch: char) -> bool {
    ch == '_'
        || ch.is_ascii_alphanumeric()
        || matches!(
            ch,
            '&' | '|' | '=' | '!' | '<' | '>' | '+' | '-' | '*' | '/' | '%' | '?' | ':'
        )
}

fn is_safe_anchor_token(token: &str) -> bool {
    if token.len() >= 3
        && token.chars().any(|ch| ch.is_ascii_lowercase())
        && token
            .chars()
            .all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
    {
        return true;
    }

    token.len() >= 2
        && token
            .chars()
            .all(|ch| !ch.is_ascii_alphanumeric() && !ch.is_whitespace())
}

/// Derive a prefilter anchor from a rule's positive root `pattern:`.
/// Negation/disjunction (`not:`/`any:`) make any single literal unsafe — a file
/// could match without containing it — so we bail to "parse everything" there.
fn derive_rule_anchor(rule: &str) -> Option<&str> {
    if rule.contains("not:") || rule.contains("any:") {
        return None;
    }
    for line in rule.lines() {
        if let Some(rest) = line.trim_start().strip_prefix("pattern:") {
            let value = rest.trim().trim_matches(['\'', '"']);
            return derive_literal_anchor(value);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_rejects_both_or_neither_query_sources() {
        assert!(StructuralQuery::new(Some("a"), Some("b")).is_err());
        assert!(StructuralQuery::new(None, None).is_err());
    }

    #[test]
    fn new_rejects_empty_query_text() {
        assert!(StructuralQuery::new(Some("   "), None).is_err());
        assert!(StructuralQuery::new(None, Some("   ")).is_err());
    }

    #[test]
    fn literal_anchor_uses_positive_pattern_but_bails_on_unsafe_rules() {
        assert_eq!(
            StructuralQuery::new(None, Some("rule:\n  pattern: await $C\n"))
                .expect("valid query")
                .literal_anchor(),
            Some("await")
        );
        assert_eq!(
            StructuralQuery::new(None, Some("rule:\n  not:\n    pattern: await $C\n"))
                .expect("valid query")
                .literal_anchor(),
            None
        );
        assert_eq!(
            StructuralQuery::new(None, Some("rule:\n  any:\n    - pattern: foo($X)\n"))
                .expect("valid query")
                .literal_anchor(),
            None
        );
    }

    #[test]
    fn literal_anchor_uses_operator_when_pattern_has_no_identifier_anchor() {
        assert_eq!(
            StructuralQuery::new(Some("$A && $A()"), None)
                .expect("valid query")
                .literal_anchor(),
            Some("&&")
        );
    }

    #[test]
    fn literal_anchor_skips_metavars_and_prefers_identifier_literals() {
        assert_eq!(
            StructuralQuery::new(Some("console.log($$$ARGS)"), None)
                .expect("valid query")
                .literal_anchor(),
            Some("console")
        );
        assert_eq!(
            StructuralQuery::new(Some("foo($X)"), None)
                .expect("valid query")
                .literal_anchor(),
            Some("foo")
        );
    }
}
