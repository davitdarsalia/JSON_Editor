// Utility to generate basic type structures from JSON objects

function capitalize(s: string): string {
  if (!s || s === "root") return "Root";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getBaseType(value: any): string {
  if (value === null) return "any";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function generateTypeScript(name: string, data: any): string {
  const typeName = capitalize(name);

  if (getBaseType(data) !== "object" || Array.isArray(data)) {
    return `export type ${typeName} = ${getTSFieldType(data)};\n`;
  }

  let result = `export interface ${typeName} {\n`;
  for (const [key, value] of Object.entries(data)) {
    const validKey = key.includes("-") || key.includes(" ") ? `"${key}"` : key;
    result += `  ${validKey}: ${getTSFieldType(value)};\n`;
  }
  result += `}\n`;
  return result;
}

function getTSFieldType(value: any): string {
  const type = getBaseType(value);
  if (type === "string") return "string";
  if (type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "array") {
    if (value.length > 0) return `${getTSFieldType(value[0])}[]`;
    return "any[]";
  }
  if (type === "object") return "Record<string, any>";
  return "any";
}

export function generateGo(name: string, data: any): string {
  const typeName = capitalize(name);

  if (getBaseType(data) !== "object" || Array.isArray(data)) {
    return `type ${typeName} ${getGoFieldType(data)}\n`;
  }

  let result = `type ${typeName} struct {\n`;
  for (const [key, value] of Object.entries(data)) {
    const fieldName = capitalize(key.replace(/[- ]/g, ""));
    result += `\t${fieldName} ${getGoFieldType(value)} \`json:"${key}"\`\n`;
  }
  result += `}\n`;
  return result;
}

function getGoFieldType(value: any): string {
  const type = getBaseType(value);
  if (type === "string") return "string";
  if (type === "number") {
    return Number.isInteger(value) ? "int" : "float64";
  }
  if (type === "boolean") return "bool";
  if (type === "array") {
    if (value.length > 0) return `[]${getGoFieldType(value[0])}`;
    return "[]interface{}";
  }
  if (type === "object") return "map[string]interface{}";
  return "interface{}";
}

export function generateRust(name: string, data: any): string {
  const typeName = capitalize(name);

  if (getBaseType(data) !== "object" || Array.isArray(data)) {
    return `pub type ${typeName} = ${getRustFieldType(data)};\n`;
  }

  let result = `#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]\n#[serde(rename_all = "camelCase")]\npub struct ${typeName} {\n`;
  for (const [key, value] of Object.entries(data)) {
    let fieldName = key.replace(/[- ]/g, "_").toLowerCase();
    if (fieldName === "type" || fieldName === "match") fieldName = `r#${fieldName}`;
    
    if (fieldName !== key) {
        result += `    #[serde(rename = "${key}")]\n`;
    }
    result += `    pub ${fieldName}: ${getRustFieldType(value)},\n`;
  }
  result += `}\n`;
  return result;
}

function getRustFieldType(value: any): string {
  const type = getBaseType(value);
  if (type === "string") return "String";
  if (type === "number") {
    return Number.isInteger(value) ? "i64" : "f64";
  }
  if (type === "boolean") return "bool";
  if (type === "array") {
    if (value.length > 0) return `Vec<${getRustFieldType(value[0])}>`;
    return "Vec<Value>";
  }
  if (type === "object") return "::std::collections::HashMap<String, Value>";
  return "Value";
}

export function generatePython(name: string, data: any): string {
  const typeName = capitalize(name);

  if (getBaseType(data) !== "object" || Array.isArray(data)) {
    return `${typeName} = ${getPythonFieldType(data)}\n`;
  }

  let result = `from typing import Any, Dict, List\nfrom pydantic import BaseModel\n\nclass ${typeName}(BaseModel):\n`;
  let hasFields = false;
  for (const [key, value] of Object.entries(data)) {
    const fieldName = key.replace(/[- ]/g, "_").toLowerCase();
    result += `    ${fieldName}: ${getPythonFieldType(value)}\n`;
    hasFields = true;
  }
  if (!hasFields) result += `    pass\n`;
  return result;
}

function getPythonFieldType(value: any): string {
  const type = getBaseType(value);
  if (type === "string") return "str";
  if (type === "number") {
    return Number.isInteger(value) ? "int" : "float";
  }
  if (type === "boolean") return "bool";
  if (type === "array") {
    if (value.length > 0) return `List[${getPythonFieldType(value[0])}]`;
    return "List[Any]";
  }
  if (type === "object") return "Dict[str, Any]";
  return "Any";
}

export function generateSwift(name: string, data: any): string {
  const typeName = capitalize(name);

  if (getBaseType(data) !== "object" || Array.isArray(data)) {
    return `typealias ${typeName} = ${getSwiftFieldType(data)}\n`;
  }

  let result = `struct ${typeName}: Codable {\n`;
  for (const [key, value] of Object.entries(data)) {
    let fieldName = key.replace(/[- ]/g, "");
    fieldName = fieldName.charAt(0).toLowerCase() + fieldName.slice(1);
    result += `    let ${fieldName}: ${getSwiftFieldType(value)}\n`;
  }
  result += `}\n`;
  return result;
}

function getSwiftFieldType(value: any): string {
  const type = getBaseType(value);
  if (type === "string") return "String";
  if (type === "number") {
    return Number.isInteger(value) ? "Int" : "Double";
  }
  if (type === "boolean") return "Bool";
  if (type === "array") {
    if (value.length > 0) return `[${getSwiftFieldType(value[0])}]`;
    return "[Any]";
  }
  if (type === "object") return "[String: Any]";
  return "Any";
}
