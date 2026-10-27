//! Value type inference used for link tooltips (`token: JWT`, `login: string`).

use crate::models::ValueType;

fn is_base64url(segment: &str) -> bool {
    !segment.is_empty()
        && segment
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'=')
}

pub fn is_jwt(value: &str) -> bool {
    let parts: Vec<&str> = value.split('.').collect();
    parts.len() == 3 && value.starts_with("eyJ") && parts[..2].iter().all(|p| is_base64url(p))
}

pub fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.char_indices().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

fn is_email(value: &str) -> bool {
    match value.split_once('@') {
        Some((local, domain)) => {
            !local.is_empty() && domain.contains('.') && !value.contains(char::is_whitespace)
        }
        None => false,
    }
}

pub fn is_numeric(value: &str) -> bool {
    !value.is_empty() && value.parse::<f64>().is_ok()
}

pub fn infer(value: &str) -> ValueType {
    let v = value.trim();
    if v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("false") {
        ValueType::Boolean
    } else if is_numeric(v) {
        ValueType::Number
    } else if is_jwt(v) {
        ValueType::Jwt
    } else if is_uuid(v) {
        ValueType::Uuid
    } else if is_email(v) {
        ValueType::Email
    } else if v.starts_with("http://") || v.starts_with("https://") {
        ValueType::Url
    } else {
        ValueType::String
    }
}

/// Heuristic filter: is this value distinctive enough to prove a data flow?
/// Short / generic values (`true`, `1`, `en`) would produce false positives.
pub fn is_significant(value: &str) -> bool {
    let v = value.trim();
    if v.len() < 6 || v.len() > 8192 {
        return false;
    }
    if matches!(v.to_ascii_lowercase().as_str(), "true" | "false" | "null" | "undefined") {
        return false;
    }
    if is_numeric(v) && v.len() < 5 {
        return false;
    }
    let first = v.chars().next();
    !v.chars().all(|c| Some(c) == first)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_types() {
        assert_eq!(infer("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc"), ValueType::Jwt);
        assert_eq!(infer("123e4567-e89b-12d3-a456-426614174000"), ValueType::Uuid);
        assert_eq!(infer("john@doe.io"), ValueType::Email);
        assert_eq!(infer("42"), ValueType::Number);
        assert_eq!(infer("hello world"), ValueType::String);
    }

    #[test]
    fn filters_noise() {
        assert!(!is_significant("true"));
        assert!(!is_significant("1234"));
        assert!(!is_significant("aaaaaaaa"));
        assert!(is_significant("abc123xyz"));
    }
}
