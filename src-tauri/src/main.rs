use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug)]
pub struct ASTNode {
    id: String,
    name: String,
    node_type: String,
    value: Option<String>,
    children: Option<Vec<ASTNode>>,
}

#[tauri::command]
fn assemble_ast(json_str: String) -> Result<ASTNode, String> {
    let v: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;

    Ok(build_node("root".to_string(), v, 0))
}

fn build_node(name: String, v: Value, depth: u32) -> ASTNode {
    let id = Uuid::new_v4().to_string();
    let max_depth = 20;

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
        _ => ASTNode {
            id,
            name,
            node_type: format!("{:?}", v).to_lowercase(),
            value: Some(v.to_string()),
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
    fn test_deep_nesting() {
        // Generates a nested structure: root -> level1 -> level2 ... level6
        let deep_json = r#"{
            "l1": {
                "l2": {
                    "l3": {
                        "l4": {
                            "l5": {
                                "l6": "target_value"
                            }
                        }
                    }
                }
            }
        }"#;

        let result = assemble_ast(deep_json.to_string()).unwrap();

        // Assertions for Level 1
        assert_eq!(result.node_type, "object");
        let l1 = &result.children.as_ref().unwrap()[0];
        assert_eq!(l1.name, "l1");

        // Navigate to Level 6
        let mut current = &result.children.as_ref().unwrap()[0];
        for _ in 0..4 {
            current = &current.children.as_ref().unwrap()[0];
        }

        // Final Level 6 Check
        let l6 = &current.children.as_ref().unwrap()[0];
        assert_eq!(l6.name, "l6");
        assert_eq!(l6.value, Some("target_value".to_string()));
    }
}
