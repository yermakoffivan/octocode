use napi_derive::napi;

/// Detect and redact all secrets from `content`, returning the sanitized string
/// with `[REDACTED-*]` placeholders plus detection metadata. `file_path` gates
/// file-context patterns (e.g. Kubernetes/`.env` secrets).
#[napi(js_name = "sanitizeContent")]
pub fn sanitize_content(
    content: String,
    file_path: Option<String>,
) -> crate::security::types::SanitizationResult {
    crate::security::sanitizer::sanitize_content(&content, file_path.as_deref())
}

/// Mask secrets in place: every even-indexed char of a matched secret becomes
/// `*`, preserving partial readability. File-context patterns are skipped.
#[napi(js_name = "maskSensitiveData")]
pub fn mask_sensitive_data(text: String) -> String {
    crate::security::detector::mask_text(text)
}

/// Number of loaded secret-detection patterns (testing / benchmarking).
#[napi(js_name = "patternCount")]
pub fn pattern_count() -> u32 {
    crate::security::patterns::PATTERNS.len() as u32
}
