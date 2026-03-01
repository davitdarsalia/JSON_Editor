use logos::Logos;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

pub struct AppState {
    /// Lossless tree (preserves duplicate keys) for AST display.
    pub raw_value: RwLock<Option<RawValue>>,
    /// Standard parsed value for format/validate.
    pub value: RwLock<Option<Value>>,
    pub recent_files: RwLock<Vec<String>>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ErrorLocation {
    line: usize,
    column: usize,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct JsonErrorInfo {
    message: String,
    location: Option<ErrorLocation>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LazyNode {
    /// Display name (e.g. key name or "[0]")
    pub name: String,
    /// Unique path segment for navigation (e.g. "0" for object index, "[0]" for array)
    pub path_segment: String,
    pub node_type: String,
    pub value: Option<String>,
    pub child_count: usize,
}

/// Lossless JSON value — preserves duplicate keys and exact structure.
#[derive(Debug, Clone)]
pub enum RawValue {
    Object(Vec<(String, RawValue)>),
    Array(Vec<RawValue>),
    String(String),
    Number(f64),
    Bool(bool),
    Null,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ParseResult {
    nodes: Vec<LazyNode>,
    repaired: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ASTNode {
    id: String,
    name: String,
    node_type: String,
    value: Option<String>,
    children: Option<Vec<ASTNode>>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AssembleResult {
    ast: ASTNode,
    repaired: bool,
}

#[derive(Logos, Debug, PartialEq, Serialize, Deserialize)]
pub enum JsonToken {
    #[regex(r#""([^"\\]|\\.)*"\s*:"#)]
    Key,
    #[regex(r#""([^"\\]|\\.)*""#)]
    String,
    #[regex(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?")]
    Number,
    #[token("true")]
    #[token("false")]
    Bool,
    #[token("null")]
    Null,
    #[token("{")]
    #[token("}")]
    #[token("[")]
    #[token("]")]
    #[token(":")]
    #[token(",")]
    Punctuation,
    #[regex(r"[ \t\n\f\r]+", logos::skip)]
    Error,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct HighlightedToken {
    pub text: String,
    pub token_type: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SearchResult {
    name: String,
    node_type: String,
    value: Option<String>,
    path: Vec<String>,
    /// Path of the parent node displayed as breadcrumb (empty for root children).
    path_display: String,
    child_count: usize,
    match_in: String,
}

// ── Lossless parser (preserves duplicate keys) ──────────────────────────────────

struct Parser<'a> {
    s: &'a str,
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(s: &'a str) -> Self {
        Self { s, pos: 0 }
    }
    fn peek(&self) -> Option<char> {
        self.s[self.pos..].chars().next()
    }
    fn skip_ws(&mut self) {
        while let Some(c) = self.peek() {
            if c.is_ascii_whitespace() {
                self.pos += c.len_utf8();
            } else {
                break;
            }
        }
    }
    fn parse_value(&mut self) -> Result<RawValue, String> {
        self.skip_ws();
        let c = self.peek().ok_or("Unexpected end of input")?;
        match c {
            '{' => {
                self.pos += 1;
                let mut pairs = Vec::new();
                self.skip_ws();
                if self.peek() == Some('}') {
                    self.pos += 1;
                    return Ok(RawValue::Object(pairs));
                }
                loop {
                    let key = self.parse_string()?;
                    self.skip_ws();
                    if self.peek() != Some(':') {
                        return Err("Expected ':' after key".into());
                    }
                    self.pos += 1;
                    self.skip_ws();
                    let val = self.parse_value()?;
                    pairs.push((key, val));
                    self.skip_ws();
                    match self.peek() {
                        Some(',') => {
                            self.pos += 1;
                            self.skip_ws();
                            if self.peek() == Some('}') {
                                self.pos += 1;
                                break;
                            }
                        }
                        Some('}') => {
                            self.pos += 1;
                            break;
                        }
                        _ => return Err("Expected ',' or '}'".into()),
                    }
                }
                Ok(RawValue::Object(pairs))
            }
            '[' => {
                self.pos += 1;
                let mut arr = Vec::new();
                self.skip_ws();
                if self.peek() == Some(']') {
                    self.pos += 1;
                    return Ok(RawValue::Array(arr));
                }
                loop {
                    self.skip_ws();
                    arr.push(self.parse_value()?);
                    self.skip_ws();
                    match self.peek() {
                        Some(',') => {
                            self.pos += 1;
                            self.skip_ws();
                            if self.peek() == Some(']') {
                                self.pos += 1;
                                break;
                            }
                        }
                        Some(']') => {
                            self.pos += 1;
                            break;
                        }
                        _ => return Err("Expected ',' or ']'".into()),
                    }
                }
                Ok(RawValue::Array(arr))
            }
            '"' => Ok(RawValue::String(self.parse_string()?)),
            't' => {
                if self.s.get(self.pos..self.pos + 4) == Some("true") {
                    self.pos += 4;
                    Ok(RawValue::Bool(true))
                } else {
                    Err("Expected 'true'".into())
                }
            }
            'f' => {
                if self.s.get(self.pos..self.pos + 5) == Some("false") {
                    self.pos += 5;
                    Ok(RawValue::Bool(false))
                } else {
                    Err("Expected 'false'".into())
                }
            }
            'n' => {
                if self.s.get(self.pos..self.pos + 4) == Some("null") {
                    self.pos += 4;
                    Ok(RawValue::Null)
                } else {
                    Err("Expected 'null'".into())
                }
            }
            '-' | '0'..='9' => {
                let start = self.pos;
                if self.peek() == Some('-') {
                    self.pos += 1;
                }
                while let Some(c) = self.peek() {
                    if c.is_ascii_digit() || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-' {
                        self.pos += c.len_utf8();
                    } else {
                        break;
                    }
                }
                let num_str = &self.s[start..self.pos];
                let n: f64 = num_str.parse().map_err(|_| "Invalid number")?;
                Ok(RawValue::Number(n))
            }
            _ => Err(format!("Unexpected character '{}'", c)),
        }
    }
    fn parse_string(&mut self) -> Result<String, String> {
        if self.peek() != Some('"') {
            return Err("Expected string".into());
        }
        self.pos += 1;
        let mut result = String::new();
        while let Some(c) = self.peek() {
            if c == '\\' {
                self.pos += 1;
                match self.peek() {
                    Some('"') => {
                        result.push('"');
                        self.pos += 1;
                    }
                    Some('\\') => {
                        result.push('\\');
                        self.pos += 1;
                    }
                    Some('/') => {
                        result.push('/');
                        self.pos += 1;
                    }
                    Some('b') => {
                        result.push('\u{8}');
                        self.pos += 1;
                    }
                    Some('f') => {
                        result.push('\u{c}');
                        self.pos += 1;
                    }
                    Some('n') => {
                        result.push('\n');
                        self.pos += 1;
                    }
                    Some('r') => {
                        result.push('\r');
                        self.pos += 1;
                    }
                    Some('t') => {
                        result.push('\t');
                        self.pos += 1;
                    }
                    Some('u') => {
                        self.pos += 1;
                        let hex: String = (0..4)
                            .filter_map(|_| {
                                let c = self.peek()?;
                                self.pos += c.len_utf8();
                                Some(c)
                            })
                            .collect();
                        if hex.len() != 4 {
                            return Err("Invalid unicode escape".into());
                        }
                        let u = u32::from_str_radix(&hex, 16).map_err(|_| "Invalid hex")?;
                        result.push(char::from_u32(u).unwrap_or('\u{fffd}'));
                    }
                    _ => {
                        result.push('\\');
                        if let Some(c) = self.peek() {
                            self.pos += c.len_utf8();
                        }
                    }
                }
            } else if c == '"' {
                self.pos += 1;
                return Ok(result);
            } else {
                result.push(c);
                self.pos += c.len_utf8();
            }
        }
        Err("Unterminated string".into())
    }
}

fn parse_raw_json(s: &str) -> Result<RawValue, String> {
    let mut p = Parser::new(s);
    p.skip_ws();
    p.parse_value()
}

/// Repair comma issues (missing or duplicate) outside of strings.
fn repair_commas(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 64);
    let mut chars = s.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    let mut just_closed = false; // we just output } or ]
    let mut skip_until_value = false; // skip duplicate comma

    while let Some(c) = chars.peek().copied() {
        if in_string {
            chars.next();
            if escaped {
                out.push(c);
                escaped = false;
            } else if c == '\\' {
                out.push(c);
                escaped = true;
            } else if c == '"' {
                out.push(c);
                in_string = false;
                just_closed = true; // end of string value
            } else {
                out.push(c);
            }
            continue;
        }

        if c == '"' {
            chars.next();
            if skip_until_value {
                skip_until_value = false;
            }
            if just_closed {
                out.push(',');
                just_closed = false;
            }
            out.push(c);
            in_string = true;
            continue;
        }

        if just_closed && (c == '{' || c == '[' || c == '-' || c.is_ascii_digit() || c == 't' || c == 'f' || c == 'n') {
            out.push(',');
            just_closed = false;
        }

        if c == '}' || c == ']' {
            chars.next();
            out.push(c);
            just_closed = true;
            skip_until_value = false;
            continue;
        }

        if c == ',' {
            chars.next();
            if skip_until_value {
                continue; // skip duplicate comma
            }
            skip_until_value = true;
            out.push(c);
            just_closed = false;
            continue;
        }

        if skip_until_value && (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
            chars.next();
            continue; // skip whitespace between duplicate commas
        }

        chars.next();
        skip_until_value = false;
        just_closed = false;
        out.push(c);
    }
    out
}

/// Escape unescaped control characters (0x00-0x1F) inside JSON strings.
/// Only modifies chars inside "...", and skips chars that follow a backslash.
fn escape_control_chars_in_strings(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    let mut chars = s.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;

    while let Some(c) = chars.next() {
        if in_string {
            if escaped {
                out.push(c);
                escaped = false;
            } else if c == '\\' {
                out.push(c);
                escaped = true;
            } else if c == '"' {
                out.push(c);
                in_string = false;
            } else if c.is_ascii() && (c as u8) < 0x20 {
                // Unescaped control character - replace with escape sequence
                match c {
                    '\n' => out.push_str("\\n"),
                    '\r' => out.push_str("\\r"),
                    '\t' => out.push_str("\\t"),
                    '\u{0c}' => out.push_str("\\f"),
                    '\u{08}' => out.push_str("\\b"),
                    _ => out.push_str(&format!("\\u{:04x}", c as u32)),
                }
            } else {
                out.push(c);
            }
        } else {
            if c == '"' {
                out.push(c);
                in_string = true;
            } else {
                out.push(c);
            }
        }
    }
    out
}

fn repair_for_raw(s: &str) -> String {
    let mut s = escape_control_chars_in_strings(s);
    s = repair_commas(&s);
    let re_single = Regex::new(r"(?m)//.*$").unwrap();
    s = re_single.replace_all(&s, "").to_string();
    let re_multi = Regex::new(r"/\*[\s\S]*?\*/").unwrap();
    s = re_multi.replace_all(&s, "").to_string();
    let re_trailing = Regex::new(r",\s*([\]}])").unwrap();
    s = re_trailing.replace_all(&s, "$1").to_string();
    s
}

fn raw_to_lazy_nodes(raw: &RawValue) -> Vec<LazyNode> {
    match raw {
        RawValue::Object(pairs) => pairs
            .iter()
            .enumerate()
            .map(|(i, (k, v))| build_lazy_from_raw(k.clone(), i.to_string(), v))
            .collect(),
        RawValue::Array(arr) => arr
            .iter()
            .enumerate()
            .map(|(i, v)| build_lazy_from_raw(format!("[{}]", i), format!("[{}]", i), v))
            .collect(),
        _ => vec![build_lazy_from_raw("(root)".into(), "0".into(), raw)],
    }
}

fn build_lazy_from_raw(name: String, path_segment: String, v: &RawValue) -> LazyNode {
    let (node_type, value, child_count) = match v {
        RawValue::Object(pairs) => ("object".into(), None, pairs.len()),
        RawValue::Array(arr) => ("array".into(), None, arr.len()),
        RawValue::String(s) => ("string".into(), Some(s.clone()), 0),
        RawValue::Number(n) => ("number".into(), Some(n.to_string()), 0),
        RawValue::Bool(b) => ("boolean".into(), Some(b.to_string()), 0),
        RawValue::Null => ("null".into(), Some("null".into()), 0),
    };
    LazyNode {
        name,
        path_segment,
        node_type,
        value,
        child_count,
    }
}

fn navigate_raw<'a>(raw: &'a RawValue, path: &[String]) -> Option<&'a RawValue> {
    if path.is_empty() {
        return Some(raw);
    }
    let seg = &path[0];
    let rest = &path[1..];
    match raw {
        RawValue::Object(pairs) => {
            let idx: usize = seg.parse().ok()?;
            let (_, child) = pairs.get(idx)?;
            navigate_raw(child, rest)
        }
        RawValue::Array(arr) => {
            let idx_str = seg.strip_prefix('[').and_then(|s| s.strip_suffix(']'))?;
            let idx: usize = idx_str.parse().ok()?;
            let child = arr.get(idx)?;
            navigate_raw(child, rest)
        }
        _ => None,
    }
}

fn raw_to_json_string(v: &RawValue) -> String {
    match v {
        RawValue::Object(pairs) => {
            let parts: Vec<String> = pairs
                .iter()
                .map(|(k, val)| format!("{}: {}", escape_json_string(k), raw_to_json_string(val)))
                .collect();
            format!("{{{}}}", parts.join(", "))
        }
        RawValue::Array(arr) => {
            let parts: Vec<String> = arr.iter().map(raw_to_json_string).collect();
            format!("[{}]", parts.join(", "))
        }
        RawValue::String(s) => escape_json_string(s),
        RawValue::Number(n) => n.to_string(),
        RawValue::Bool(b) => b.to_string(),
        RawValue::Null => "null".into(),
    }
}

fn escape_json_string(s: &str) -> String {
    let mut out = String::from('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

// ── Full-tree search ──────────────────────────────────────────────────────────

const SEARCH_LIMIT: usize = 500;

fn search_raw(
    raw: &RawValue,
    name: &str,
    path_segs: Vec<String>,
    parent_display: &str,
    query: &str,
    results: &mut Vec<SearchResult>,
) {
    if results.len() >= SEARCH_LIMIT {
        return;
    }
    let q = query.to_lowercase();
    let match_key = name.to_lowercase().contains(&q);
    let (node_type, value, child_count) = match raw {
        RawValue::Object(pairs) => ("object", None, pairs.len()),
        RawValue::Array(arr) => ("array", None, arr.len()),
        RawValue::String(s) => ("string", Some(s.clone()), 0),
        RawValue::Number(n) => ("number", Some(n.to_string()), 0),
        RawValue::Bool(b) => ("boolean", Some(b.to_string()), 0),
        RawValue::Null => ("null", Some("null".into()), 0),
    };
    let match_value = value.as_deref().map_or(false, |v| v.to_lowercase().contains(&q));
    if match_key || match_value {
        results.push(SearchResult {
            name: name.to_string(),
            node_type: node_type.to_string(),
            value: value.clone(),
            path: path_segs.clone(),
            path_display: parent_display.to_string(),
            child_count,
            match_in: if match_key { "key".into() } else { "value".into() },
        });
    }
    // Build display string for this node's children
    let cur = if parent_display.is_empty() {
        name.to_string()
    } else {
        format!("{} › {}", parent_display, name)
    };
    match raw {
        RawValue::Object(pairs) => {
            for (i, (k, v)) in pairs.iter().enumerate() {
                if results.len() >= SEARCH_LIMIT { return; }
                let mut cp = path_segs.clone();
                cp.push(i.to_string());
                search_raw(v, k, cp, &cur, query, results);
            }
        }
        RawValue::Array(arr) => {
            for (i, v) in arr.iter().enumerate() {
                if results.len() >= SEARCH_LIMIT { return; }
                let mut cp = path_segs.clone();
                cp.push(format!("[{}]", i));
                let nm = format!("[{}]", i);
                search_raw(v, &nm, cp, &cur, query, results);
            }
        }
        _ => {}
    }
}

// ── Pure helpers (for Value / format / validate) ───────────────────────────────

fn build_lazy_node(name: String, path_segment: String, v: &Value) -> LazyNode {
    match v {
        Value::Object(map) => LazyNode {
            name,
            path_segment,
            node_type: "object".into(),
            value: None,
            child_count: map.len(),
        },
        Value::Array(arr) => LazyNode {
            name,
            path_segment,
            node_type: "array".into(),
            value: None,
            child_count: arr.len(),
        },
        Value::String(s) => LazyNode {
            name,
            path_segment,
            node_type: "string".into(),
            value: Some(s.clone()),
            child_count: 0,
        },
        Value::Number(n) => LazyNode {
            name,
            path_segment,
            node_type: "number".into(),
            value: Some(n.to_string()),
            child_count: 0,
        },
        Value::Bool(b) => LazyNode {
            name,
            path_segment,
            node_type: "boolean".into(),
            value: Some(b.to_string()),
            child_count: 0,
        },
        Value::Null => LazyNode {
            name,
            path_segment,
            node_type: "null".into(),
            value: Some("null".into()),
            child_count: 0,
        },
    }
}

fn root_children(v: &Value) -> Vec<LazyNode> {
    match v {
        Value::Object(map) => map
            .iter()
            .enumerate()
            .map(|(i, (k, v))| build_lazy_node(k.clone(), i.to_string(), v))
            .collect(),
        Value::Array(arr) => arr
            .iter()
            .enumerate()
            .map(|(i, v)| build_lazy_node(format!("[{}]", i), format!("[{}]", i), v))
            .collect(),
        _ => vec![build_lazy_node("root".into(), "0".into(), v)],
    }
}

fn navigate<'a>(value: &'a Value, path: &[String]) -> Option<&'a Value> {
    if path.is_empty() {
        return Some(value);
    }
    let seg = &path[0];
    let rest = &path[1..];
    match value {
        Value::Object(map) => {
            let idx: usize = seg.parse().ok()?;
            let (_, v) = map.iter().nth(idx)?;
            navigate(v, rest)
        }
        Value::Array(arr) => {
            let idx_str = seg.strip_prefix('[').and_then(|s| s.strip_suffix(']'))?;
            let idx: usize = idx_str.parse().ok()?;
            let v = arr.get(idx)?;
            navigate(v, rest)
        }
        _ => None,
    }
}

/// Convert serde_json error to a human-readable message with fix hints.
fn humanize_json_error(e: &serde_json::Error) -> (String, usize, usize) {
    let msg = e.to_string();
    let line = e.line();
    let col = e.column();

    let (friendly, fix_hint) = if msg.contains("EOF while parsing") {
        (
            "The JSON is incomplete — it ends unexpectedly.",
            "Add the missing part: close any open brackets ] or braces }.",
        )
    } else if msg.contains("expected `,` or `}`") {
        (
            "Missing comma or extra comma between items in an object.",
            "Add a comma between each key-value pair, or remove an extra comma.",
        )
    } else if msg.contains("expected `,` or `]`") {
        (
            "Missing comma or extra comma between items in an array.",
            "Add a comma between each value, or remove an extra comma.",
        )
    } else if msg.contains("expected `:`") {
        (
            "Missing colon after a key name.",
            "Use a colon after each key, e.g. \"name\": \"value\".",
        )
    } else if msg.contains("trailing comma") {
        (
            "Trailing comma not allowed — a comma after the last item.",
            "Remove the comma after the last item in the object or array.",
        )
    } else if msg.contains("key must be a string") {
        (
            "Object keys must be in double quotes.",
            "Wrap the key in quotes, e.g. \"myKey\": 123.",
        )
    } else if msg.contains("invalid number") {
        (
            "Invalid number format.",
            "Numbers cannot start with 0 (except 0.5), and must not have letters.",
        )
    } else if msg.contains("invalid escape") || msg.contains("invalid unicode") {
        (
            "Invalid escape sequence in a string.",
            "Use valid escapes: \\\", \\\\, \\/, \\b, \\f, \\n, \\r, \\t, or \\uXXXX.",
        )
    } else if msg.contains("control character") {
        (
            "Unescaped control character in a string.",
            "Use \\n for newline, \\t for tab, or escape other special characters.",
        )
    } else if msg.contains("expected value") {
        (
            "Expected a value but found something else.",
            "Check for an extra comma, missing value, or wrong character.",
        )
    } else if msg.contains("expected ident") || msg.contains("expected `null`") || msg.contains("expected `true`") || msg.contains("expected `false`") {
        (
            "Invalid value — expected true, false, or null.",
            "Use lowercase: true, false, or null (no quotes).",
        )
    } else if msg.contains("expected `\"`") || msg.contains("expected string") {
        (
            "Expected a string in double quotes.",
            "Wrap text in double quotes: \"your text here\".",
        )
    } else {
        (
            "Invalid JSON syntax.",
            "Check the structure: brackets must match, strings need quotes.",
        )
    };

    let full = format!("{}\n\nHow to fix: {}", friendly, fix_hint);
    (full, line, col)
}

fn parse_and_repair(json_str: &str) -> Result<(Value, bool), serde_json::Error> {
    if let Ok(v) = serde_json::from_str::<Value>(json_str) {
        return Ok((v, false));
    }
    let mut s = escape_control_chars_in_strings(json_str);
    s = repair_commas(&s);
    let re_single = Regex::new(r"(?m)//.*$").unwrap();
    s = re_single.replace_all(&s, "").to_string();
    let re_multi = Regex::new(r"/\*[\s\S]*?\*/").unwrap();
    s = re_multi.replace_all(&s, "").to_string();
    let re_trailing = Regex::new(r",\s*([\]}])").unwrap();
    s = re_trailing.replace_all(&s, "$1").to_string();
    match serde_json::from_str::<Value>(&s) {
        Ok(v) => Ok((v, true)),
        Err(e) => Err(e),
    }
}

// ── Recent files persistence ───────────────────────────────────────────────────

fn recent_files_path(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    let dir = app.path().app_data_dir()?;
    Ok(dir.join("recent_files.json"))
}

fn load_recent_files(app: &AppHandle) -> Vec<String> {
    let path = match recent_files_path(app) {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    let data = match fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    match serde_json::from_str::<Vec<String>>(&data) {
        Ok(files) => files.into_iter().take(10).collect(),
        Err(_) => Vec::new(),
    }
}

fn save_recent_files(app: &AppHandle, files: &[String]) {
    let path = match recent_files_path(app) {
        Ok(p) => p,
        Err(_) => return,
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let data = match serde_json::to_string_pretty(files) {
        Ok(d) => d,
        Err(_) => return,
    };
    let _ = fs::write(path, data);
}

// ── Menu builder ──────────────────────────────────────────────────────────────

fn build_app_menu(
    app: &AppHandle,
    recent_files: &[String],
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    // ── App / system menu (macOS first menu) ──────────────────────────────
    let about = PredefinedMenuItem::about(app, None, None)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let hide = PredefinedMenuItem::hide(app, None)?;
    let quit = PredefinedMenuItem::quit(app, None)?;
    let app_menu = SubmenuBuilder::new(app, "Json Kit")
        .item(&about)
        .item(&sep)
        .item(&hide)
        .item(&quit)
        .build()?;

    // ── File menu ─────────────────────────────────────────────────────────
    let open_file = MenuItemBuilder::with_id("open-file", "Open File…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    let mut recent_builder = SubmenuBuilder::new(app, "Open Recent");
    if recent_files.is_empty() {
        let no_recent = MenuItemBuilder::with_id("no-recent", "No Recent Files")
            .enabled(false)
            .build(app)?;
        recent_builder = recent_builder.item(&no_recent);
    } else {
        for (i, path) in recent_files.iter().take(10).enumerate() {
            let label = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(path.as_str())
                .to_string();
            let item = MenuItemBuilder::with_id(format!("recent-{}", i), label).build(app)?;
            recent_builder = recent_builder.item(&item);
        }
        let clear_sep = PredefinedMenuItem::separator(app)?;
        let clear = MenuItemBuilder::with_id("clear-recent", "Clear Recent Items").build(app)?;
        recent_builder = recent_builder.item(&clear_sep).item(&clear);
    }
    let recent_menu = recent_builder.build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&open_file)
        .item(&recent_menu)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let pretty = MenuItemBuilder::with_id("pretty-json", "Pretty JSON")
        .accelerator("CmdOrCtrl+Shift+F")
        .build(app)?;
    let validate = MenuItemBuilder::with_id("validate-json", "Validate JSON")
        .accelerator("CmdOrCtrl+Shift+V")
        .build(app)?;
    let kit_menu = SubmenuBuilder::new(app, "Kit")
        .item(&pretty)
        .item(&validate)
        .build()?;

    MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&kit_menu)
        .build()
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn parse_json(json_str: String, state: State<AppState>) -> Result<ParseResult, JsonErrorInfo> {
    if json_str.trim().is_empty() {
        *state.raw_value.write().unwrap() = None;
        *state.value.write().unwrap() = None;
        return Ok(ParseResult {
            nodes: vec![],
            repaired: false,
        });
    }
    // Fast path: try the original input as-is, before any repair.
    // This correctly handles valid JSON — including lock files that contain
    // URLs (https://...) which the comment-stripping regex would corrupt.
    if let Ok(raw) = parse_raw_json(json_str.trim()) {
        let nodes = raw_to_lazy_nodes(&raw);
        *state.raw_value.write().unwrap() = Some(raw);
        *state.value.write().unwrap() = serde_json::from_str(json_str.trim()).ok();
        return Ok(ParseResult { nodes, repaired: false });
    }

    // Repair path: only reached for malformed JSON (JS comments, trailing
    // commas, missing commas, unescaped control chars, etc.)
    let repaired_str = repair_for_raw(&json_str);
    match parse_raw_json(&repaired_str) {
        Ok(raw) => {
            let nodes = raw_to_lazy_nodes(&raw);
            *state.raw_value.write().unwrap() = Some(raw);
            *state.value.write().unwrap() = parse_and_repair(&repaired_str).ok().map(|(v, _)| v);
            Ok(ParseResult { nodes, repaired: true })
        }
        Err(_) => {
            match parse_and_repair(&repaired_str) {
                Ok((v, _)) => {
                    let nodes = root_children(&v);
                    *state.raw_value.write().unwrap() = None;
                    *state.value.write().unwrap() = Some(v);
                    Ok(ParseResult { nodes, repaired: true })
                }
                Err(e) => {
                    *state.raw_value.write().unwrap() = None;
                    *state.value.write().unwrap() = None;
                    let (message, line, column) = humanize_json_error(&e);
                    Err(JsonErrorInfo {
                        message,
                        location: Some(ErrorLocation { line, column }),
                    })
                }
            }
        }
    }
}

#[tauri::command]
fn get_children(path: Vec<String>, state: State<AppState>) -> Result<Vec<LazyNode>, String> {
    if let Ok(guard) = state.raw_value.read() {
        if let Some(raw) = guard.as_ref() {
            let target = if path.is_empty() {
                raw
            } else {
                navigate_raw(raw, &path).ok_or("Path not found")?
            };
            return match target {
                RawValue::Object(pairs) => Ok(pairs
                    .iter()
                    .enumerate()
                    .map(|(i, (k, v))| build_lazy_from_raw(k.clone(), i.to_string(), v))
                    .collect()),
                RawValue::Array(arr) => Ok(arr
                    .iter()
                    .enumerate()
                    .map(|(i, v)| build_lazy_from_raw(format!("[{}]", i), format!("[{}]", i), v))
                    .collect()),
                _ => Err("Node has no children".into()),
            };
        }
    }
    let r = state.value.read().map_err(|e| e.to_string())?;
    let value = r.as_ref().ok_or("No JSON loaded")?;
    let target = if path.is_empty() {
        value
    } else {
        navigate(value, &path).ok_or("Path not found")?
    };
    match target {
        Value::Object(map) => Ok(map
            .iter()
            .enumerate()
            .map(|(i, (k, v))| build_lazy_node(k.clone(), i.to_string(), v))
            .collect()),
        Value::Array(arr) => Ok(arr
            .iter()
            .enumerate()
            .map(|(i, v)| build_lazy_node(format!("[{}]", i), format!("[{}]", i), v))
            .collect()),
        _ => Err("Node has no children".into()),
    }
}

#[tauri::command]
fn get_subtree(path: Vec<String>, state: State<AppState>) -> Result<String, String> {
    if let Ok(guard) = state.raw_value.read() {
        if let Some(raw) = guard.as_ref() {
            let target = if path.is_empty() {
                raw
            } else {
                navigate_raw(raw, &path).ok_or("Path not found")?
            };
            return Ok(raw_to_json_string(target));
        }
    }
    let r = state.value.read().map_err(|e| e.to_string())?;
    let value = r.as_ref().ok_or("No JSON loaded")?;
    let target = if path.is_empty() {
        value
    } else {
        navigate(value, &path).ok_or("Path not found")?
    };
    serde_json::to_string_pretty(target).map_err(|e| e.to_string())
}

/// Lightweight validation — does NOT update AppState, just checks correctness.
#[tauri::command]
fn validate_json(json_str: String) -> Result<bool, JsonErrorInfo> {
    match parse_and_repair(&json_str) {
        Ok(_) => Ok(true),
        Err(e) => {
            let (message, line, column) = humanize_json_error(&e);
            Err(JsonErrorInfo {
                message,
                location: Some(ErrorLocation { line, column }),
            })
        }
    }
}

#[tauri::command]
fn format_json(json_str: String) -> Result<String, String> {
    match parse_and_repair(&json_str) {
        Ok((v, _)) => serde_json::to_string_pretty(&v).map_err(|e| e.to_string()),
        Err(e) => {
            let (message, line, col) = humanize_json_error(&e);
            let short = message.lines().next().unwrap_or("Invalid JSON");
            Err(format!("{} — fix at line {}, column {}", short, line, col))
        }
    }
}

#[tauri::command]
fn search_json(query: String, state: State<AppState>) -> Vec<SearchResult> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return vec![];
    }
    let mut results = Vec::new();
    if let Ok(guard) = state.raw_value.read() {
        if let Some(raw) = guard.as_ref() {
            match raw {
                RawValue::Object(pairs) => {
                    for (i, (k, v)) in pairs.iter().enumerate() {
                        if results.len() >= SEARCH_LIMIT { break; }
                        search_raw(v, k, vec![i.to_string()], "", &q, &mut results);
                    }
                }
                RawValue::Array(arr) => {
                    for (i, v) in arr.iter().enumerate() {
                        if results.len() >= SEARCH_LIMIT { break; }
                        let nm = format!("[{}]", i);
                        search_raw(v, &nm, vec![nm.clone()], "", &q, &mut results);
                    }
                }
                _ => {}
            }
        }
    }
    results
}

#[tauri::command]
fn highlight_json(json_str: String) -> Vec<HighlightedToken> {
    let lex = JsonToken::lexer(&json_str);
    lex.spanned()
        .map(|(token, span)| {
            let text = json_str[span].to_string()
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;");
            let token_type = match token {
                Ok(JsonToken::Key) => "key",
                Ok(JsonToken::String) => "string",
                Ok(JsonToken::Number) => "number",
                Ok(JsonToken::Bool) => "boolean",
                Ok(JsonToken::Null) => "null",
                Ok(JsonToken::Punctuation) => "punctuation",
                _ => "text",
            };
            HighlightedToken {
                text,
                token_type: token_type.into(),
            }
        })
        .collect()
}

fn build_node(name: String, v: Value, depth: u32) -> ASTNode {
    let id = Uuid::new_v4().to_string();
    if depth > 50 {
        return ASTNode {
            id,
            name,
            node_type: "error".into(),
            value: Some("Max depth exceeded".into()),
            children: None,
        };
    }
    match v {
        Value::Object(map) => ASTNode {
            id,
            name,
            node_type: "object".into(),
            value: None,
            children: Some(
                map.into_iter()
                    .map(|(k, val)| build_node(k, val, depth + 1))
                    .collect(),
            ),
        },
        Value::Array(arr) => ASTNode {
            id,
            name,
            node_type: "array".into(),
            value: None,
            children: Some(
                arr.into_iter()
                    .enumerate()
                    .map(|(i, val)| build_node(format!("[{}]", i), val, depth + 1))
                    .collect(),
            ),
        },
        Value::String(s) => ASTNode {
            id,
            name,
            node_type: "string".into(),
            value: Some(s),
            children: None,
        },
        Value::Number(n) => ASTNode {
            id,
            name,
            node_type: "number".into(),
            value: Some(n.to_string()),
            children: None,
        },
        Value::Bool(b) => ASTNode {
            id,
            name,
            node_type: "boolean".into(),
            value: Some(b.to_string()),
            children: None,
        },
        Value::Null => ASTNode {
            id,
            name,
            node_type: "null".into(),
            value: Some("null".into()),
            children: None,
        },
    }
}

#[tauri::command]
fn assemble_ast(json_str: String) -> Result<AssembleResult, JsonErrorInfo> {
    match parse_and_repair(&json_str) {
        Ok((v, repaired)) => Ok(AssembleResult {
            ast: build_node("root".into(), v, 0),
            repaired,
        }),
        Err(e) => {
            let (message, line, column) = humanize_json_error(&e);
            Err(JsonErrorInfo {
                message,
                location: Some(ErrorLocation { line, column }),
            })
        }
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            raw_value: RwLock::new(None),
            value: RwLock::new(None),
            recent_files: RwLock::new(Vec::new()),
        })
        .setup(|app| {
            let handle = app.handle();

            // Load recent files from disk and populate state
            let recent = load_recent_files(handle);
            {
                let state = app.state::<AppState>();
                let mut files = state.recent_files.write().unwrap();
                *files = recent;
            }

            // Build and set the initial menu
            let recent_snap = app.state::<AppState>().recent_files.read().unwrap().clone();
            let menu = build_app_menu(handle, &recent_snap)?;
            app.set_menu(menu)?;

            // Handle menu events
            app.on_menu_event(|app, event| {
                let id = event.id().as_ref().to_string();
                match id.as_str() {
                    // ── File → Open File ──────────────────────────────────
                    "open-file" => {
                        let app2 = app.clone();
                        app.dialog()
                            .file()
                            .add_filter("JSON Files", &["json", "jsonc"])
                            .pick_file(move |result| {
                                let Some(file_path) = result else { return };
                                let Some(path) = file_path.as_path() else { return };

                                let path_str = path.to_string_lossy().to_string();
                                let Ok(content) = std::fs::read_to_string(path) else { return };

                                // Update in-memory recent list
                                {
                                    let state = app2.state::<AppState>();
                                    let mut recent = state.recent_files.write().unwrap();
                                    recent.retain(|f| f != &path_str);
                                    recent.insert(0, path_str);
                                    recent.truncate(10);
                                    let snap: Vec<String> = recent.clone();
                                    drop(recent);
                                    save_recent_files(&app2, &snap);
                                }

                                // Rebuild menu with updated recents
                                let recent_snap = app2
                                    .state::<AppState>()
                                    .recent_files
                                    .read()
                                    .unwrap()
                                    .clone();
                                if let Ok(new_menu) = build_app_menu(&app2, &recent_snap) {
                                    app2.set_menu(new_menu).ok();
                                    // Re-attach the handler after menu rebuild
                                    let app3 = app2.clone();
                                    app2.on_menu_event(move |_app, _ev| {
                                        // No-op: the outer handler continues to be active
                                        let _ = &app3;
                                    });
                                }

                                app2.emit("file-opened", content).ok();
                            });
                    }

                    // ── File → Open Recent → item ────────────────────────
                    id if id.starts_with("recent-") => {
                        let idx: usize = id["recent-".len()..].parse().unwrap_or(0);
                        let state = app.state::<AppState>();
                        let mut recent = state.recent_files.write().unwrap();
                        if let Some(path) = recent.get(idx).cloned() {
                            recent.retain(|f| f != &path);
                            recent.insert(0, path.clone());
                            recent.truncate(10);
                            let snap: Vec<String> = recent.clone();
                            drop(recent);
                            save_recent_files(app, &snap);
                            if let Ok(content) = std::fs::read_to_string(&path) {
                                app.emit("file-opened", content).ok();
                            }
                            // Rebuild menu so Open Recent reflects new order
                            if let Ok(new_menu) = build_app_menu(app, &snap) {
                                app.set_menu(new_menu).ok();
                            }
                        }
                    }

                    // ── File → Open Recent → Clear ───────────────────────
                    "clear-recent" => {
                        app.state::<AppState>().recent_files.write().unwrap().clear();
                        save_recent_files(app, &[]);
                        if let Ok(new_menu) = build_app_menu(app, &[]) {
                            app.set_menu(new_menu).ok();
                        }
                    }

                    // ── Kit → Pretty JSON ────────────────────────────────
                    "pretty-json" => {
                        app.emit("menu:pretty-json", ()).ok();
                    }

                    // ── Kit → Validate JSON ──────────────────────────────
                    "validate-json" => {
                        app.emit("menu:validate-json", ()).ok();
                    }

                    _ => {}
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            parse_json,
            get_children,
            get_subtree,
            validate_json,
            format_json,
            search_json,
            assemble_ast,
            highlight_json,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invalid_json_diagnostics() {
        let broken = r#"{ "name": "Davit", "age": 25 "#;
        let result = assemble_ast(broken.to_string());
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.message.contains("incomplete") || err.message.contains("unexpectedly"));
        assert!(err.location.is_some());
    }

    #[test]
    fn test_fuzzy_json_repair() {
        let fuzz = r#"{
            "name": "Davit", // A comment
            "age": 25,
        }"#;
        let result = assemble_ast(fuzz.to_string());
        assert!(result.is_ok());
        let val = result.unwrap();
        assert!(val.repaired);
        assert_eq!(val.ast.node_type, "object");
    }

    #[test]
    fn test_comma_repair_missing() {
        // Missing comma between } and " (package-lock style)
        let json = r#"{"packages":{"":{"name":"pkg"}"other":{"name":"x"}}}"#;
        let result = assemble_ast(json.to_string());
        assert!(result.is_ok());
    }

    #[test]
    fn test_comma_repair_duplicate() {
        let json = r#"{"a": 1,, "b": 2}"#;
        let result = assemble_ast(json.to_string());
        assert!(result.is_ok());
    }

    #[test]
    fn test_highlight_json_escapes_html() {
        let json = r#"{"html": "<script>alert(1)</script> & text"}"#;
        let tokens = highlight_json(json.to_string());
        let t = tokens.iter().find(|t| t.text.contains("script")).unwrap();
        assert!(t.text.contains("&lt;script&gt;"));
        assert!(t.text.contains("&amp; text"));
        assert!(!t.text.contains('<'));
        assert!(!t.text.contains('>'));
    }

    #[test]
    fn test_navigate_object() {
        let json: Value = serde_json::from_str(r#"{"a": {"b": 42}}"#).unwrap();
        assert_eq!(
            navigate(&json, &["0".into(), "0".into()]),
            Some(&Value::Number(42.into()))
        );
    }

    #[test]
    fn test_navigate_array_bracket_syntax() {
        let json: Value = serde_json::from_str(r#"[10, 20, 30]"#).unwrap();
        assert_eq!(
            navigate(&json, &["[1]".into()]),
            Some(&Value::Number(20.into()))
        );
    }

    #[test]
    fn test_root_children_counts() {
        let json: Value = serde_json::from_str(r#"{"a": [1,2,3]}"#).unwrap();
        let nodes = root_children(&json);
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].child_count, 3);
    }

    #[test]
    fn test_validate_json_valid() {
        assert!(validate_json(r#"{"ok": true}"#.into()).is_ok());
    }

    #[test]
    fn test_validate_json_invalid() {
        assert!(validate_json("{bad".into()).is_err());
    }

    #[test]
    fn test_parse_and_repair_clean() {
        let (_, repaired) = parse_and_repair(r#"{"ok": true}"#).unwrap();
        assert!(!repaired);
    }
}
