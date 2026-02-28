use logos::Logos;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::RwLock;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

pub struct AppState {
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
    name: String,
    node_type: String,
    value: Option<String>,
    child_count: usize,
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

// ── Pure helpers ──────────────────────────────────────────────────────────────

fn build_lazy_node(name: String, v: &Value) -> LazyNode {
    match v {
        Value::Object(map) => LazyNode {
            name,
            node_type: "object".into(),
            value: None,
            child_count: map.len(),
        },
        Value::Array(arr) => LazyNode {
            name,
            node_type: "array".into(),
            value: None,
            child_count: arr.len(),
        },
        Value::String(s) => LazyNode {
            name,
            node_type: "string".into(),
            value: Some(s.clone()),
            child_count: 0,
        },
        Value::Number(n) => LazyNode {
            name,
            node_type: "number".into(),
            value: Some(n.to_string()),
            child_count: 0,
        },
        Value::Bool(b) => LazyNode {
            name,
            node_type: "boolean".into(),
            value: Some(b.to_string()),
            child_count: 0,
        },
        Value::Null => LazyNode {
            name,
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
            .map(|(k, v)| build_lazy_node(k.clone(), v))
            .collect(),
        Value::Array(arr) => arr
            .iter()
            .enumerate()
            .map(|(i, v)| build_lazy_node(format!("[{}]", i), v))
            .collect(),
        _ => vec![build_lazy_node("root".into(), v)],
    }
}

fn navigate<'a>(value: &'a Value, path: &[String]) -> Option<&'a Value> {
    if path.is_empty() {
        return Some(value);
    }
    let key = &path[0];
    let rest = &path[1..];
    match value {
        Value::Object(map) => map.get(key.as_str()).and_then(|v| navigate(v, rest)),
        Value::Array(arr) => {
            let idx_str = key
                .strip_prefix('[')
                .and_then(|s| s.strip_suffix(']'))
                .unwrap_or(key.as_str());
            idx_str
                .parse::<usize>()
                .ok()
                .and_then(|i| arr.get(i))
                .and_then(|v| navigate(v, rest))
        }
        _ => None,
    }
}

fn parse_and_repair(json_str: &str) -> Result<(Value, bool), serde_json::Error> {
    if let Ok(v) = serde_json::from_str::<Value>(json_str) {
        return Ok((v, false));
    }
    let mut s = json_str.to_string();
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

// ── Menu builder ──────────────────────────────────────────────────────────────

fn build_app_menu(
    app: &AppHandle,
    recent_files: &[String],
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    // ── App / system menu (macOS first menu) ──────────────────────────────
    let about = PredefinedMenuItem::about(app, None, None)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = PredefinedMenuItem::quit(app, None)?;
    let app_menu = SubmenuBuilder::new(app, "Json Kit")
        .item(&about)
        .item(&sep)
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
        *state.value.write().unwrap() = None;
        return Ok(ParseResult {
            nodes: vec![],
            repaired: false,
        });
    }
    match parse_and_repair(&json_str) {
        Ok((v, repaired)) => {
            let nodes = root_children(&v);
            *state.value.write().unwrap() = Some(v);
            Ok(ParseResult { nodes, repaired })
        }
        Err(e) => {
            *state.value.write().unwrap() = None;
            Err(JsonErrorInfo {
                message: e.to_string(),
                location: Some(ErrorLocation {
                    line: e.line(),
                    column: e.column(),
                }),
            })
        }
    }
}

#[tauri::command]
fn get_children(path: Vec<String>, state: State<AppState>) -> Result<Vec<LazyNode>, String> {
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
            .map(|(k, v)| build_lazy_node(k.clone(), v))
            .collect()),
        Value::Array(arr) => Ok(arr
            .iter()
            .enumerate()
            .map(|(i, v)| build_lazy_node(format!("[{}]", i), v))
            .collect()),
        _ => Err("Node has no children".into()),
    }
}

#[tauri::command]
fn get_subtree(path: Vec<String>, state: State<AppState>) -> Result<String, String> {
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
        Err(e) => Err(JsonErrorInfo {
            message: e.to_string(),
            location: Some(ErrorLocation {
                line: e.line(),
                column: e.column(),
            }),
        }),
    }
}

#[tauri::command]
fn format_json(json_str: String) -> Result<String, String> {
    match parse_and_repair(&json_str) {
        Ok((v, _)) => serde_json::to_string_pretty(&v).map_err(|e| e.to_string()),
        Err(e) => Err(e.to_string()),
    }
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
        Err(e) => Err(JsonErrorInfo {
            message: e.to_string(),
            location: Some(ErrorLocation {
                line: e.line(),
                column: e.column(),
            }),
        }),
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            value: RwLock::new(None),
            recent_files: RwLock::new(Vec::new()),
        })
        .setup(|app| {
            let handle = app.handle();

            // Build and set the initial menu
            let menu = build_app_menu(handle, &[])?;
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
                        let recent = state.recent_files.read().unwrap();
                        if let Some(path) = recent.get(idx).cloned() {
                            drop(recent);
                            if let Ok(content) = std::fs::read_to_string(&path) {
                                app.emit("file-opened", content).ok();
                            }
                        }
                    }

                    // ── File → Open Recent → Clear ───────────────────────
                    "clear-recent" => {
                        app.state::<AppState>().recent_files.write().unwrap().clear();
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
        assert!(err.message.contains("EOF"));
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
            navigate(&json, &["a".into(), "b".into()]),
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
