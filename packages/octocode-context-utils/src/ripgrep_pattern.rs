use napi_derive::napi;
use regex::Regex;

#[napi(object)]
pub struct RipgrepPatternValidationResult {
    pub valid: bool,
    pub error: Option<String>,
}

pub fn validate(pattern: &str, fixed_string: bool, perl_regex: bool) -> RipgrepPatternValidationResult {
    if pattern.is_empty() {
        return RipgrepPatternValidationResult {
            valid: false,
            error: Some("pattern is empty — provide a non-empty search string".to_owned()),
        };
    }

    if fixed_string || perl_regex {
        return RipgrepPatternValidationResult {
            valid: true,
            error: None,
        };
    }

    match Regex::new(pattern) {
        Ok(_) => RipgrepPatternValidationResult {
            valid: true,
            error: None,
        },
        Err(err) => RipgrepPatternValidationResult {
            valid: false,
            error: Some(err.to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_rejects_invalid_default_ripgrep_regex() {
        let result = validate("(", false, false);
        assert!(!result.valid);
        assert!(result.error.is_some());
    }

    #[test]
    fn validate_accepts_fixed_string_without_regex_parsing() {
        let result = validate("(", true, false);
        assert!(result.valid);
    }

    #[test]
    fn validate_does_not_js_validate_perl_regex() {
        let result = validate("(?<=foo)bar", false, true);
        assert!(result.valid);
    }
}
