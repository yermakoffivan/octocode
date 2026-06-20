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
    let mut best: Option<&str> = None;
    for token in pattern.split(|ch: char| !(ch == '_' || ch.is_ascii_alphanumeric())) {
        if token.len() < 3 || token.chars().all(|ch| ch.is_ascii_uppercase()) {
            continue;
        }
        if best.is_none_or(|current| token.len() > current.len()) {
            best = Some(token);
        }
    }
    best
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
}
