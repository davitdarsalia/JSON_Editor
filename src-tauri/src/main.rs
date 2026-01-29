use serde::{Deserialize, Serialize};
use serde_json::{Value};
use uuid::Uuid;

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

#[derive(Serialize, Deserialize, Debug)]
pub struct ASTNode {
    id: String,
    name: String,
    node_type: String,
    value: Option<String>,
    children: Option<Vec<ASTNode>>,
}

#[tauri::command]
fn assemble_ast(json_str: String) -> Result<ASTNode, JsonErrorInfo> {
    match serde_json::from_str::<Value>(&json_str) {
        Ok(v) => Ok(build_node("root".to_string(), v, 0)),
        Err(e) => Err(JsonErrorInfo {
            message: e.to_string(),
            location: Some(ErrorLocation {
                line: e.line(),
                column: e.column(),
            }),
        }),
    }
}

fn build_node(name: String, v: Value, depth: u32) -> ASTNode {
    let id = Uuid::new_v4().to_string();
    let max_depth = 50;

    if depth > max_depth {
        return ASTNode {
            id,
            name,
            node_type: "error".to_string(),
            value: Some("Max depth exceeded".to_string()),
            children: None,
        };
    }

    match v {
        Value::Object(map) => {
            let children: Vec<ASTNode> = map
                .into_iter()
                .map(|(k, val)| build_node(k, val, depth + 1))
                .collect();

            ASTNode {
                id,
                name,
                node_type: "object".to_string(),
                value: None,
                children: Some(children),
            }
        }
        Value::Array(arr) => {
            let children: Vec<ASTNode> = arr
                .into_iter()
                .enumerate()
                .map(|(i, val)| build_node(format!("[{}]", i), val, depth + 1))
                .collect();

            ASTNode {
                id,
                name,
                node_type: "array".to_string(),
                value: None,
                children: Some(children),
            }
        }
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![assemble_ast])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invalid_json_diagnostics() {
        let broken_json = r#"{ "name": "Davit", "age": 25 "#;
        let result = assemble_ast(broken_json.to_string());

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.message.contains("EOF"));
        assert!(err.location.is_some());
    }
}
