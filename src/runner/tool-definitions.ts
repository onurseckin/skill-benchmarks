import type { ToolDefinition } from "./types.js";

export const STANDARD_TOOLS: ReadonlyArray<ToolDefinition> = [
  {
    name: "run_command",
    description: "Execute a shell command within the workspace environment",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command line string to execute" },
        timeout_seconds: { type: "number", description: "Timeout in seconds" },
        env: {
          type: "object",
          description: "Environment variables",
          additionalProperties: { type: "string" },
        },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read the contents of a file within the workspace",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file" },
        start_line: { type: "number", description: "Optional 1-indexed starting line number" },
        end_line: { type: "number", description: "Optional 1-indexed ending line number" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file in the workspace",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to write" },
        content: { type: "string", description: "Text content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file_content",
    description: "Replace target content with new content in a file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to edit" },
        target_content: { type: "string", description: "Exact text content to replace" },
        replacement_content: { type: "string", description: "Replacement text" },
        start_line: { type: "number", description: "Optional starting line search constraint" },
        end_line: { type: "number", description: "Optional ending line search constraint" },
        allow_multiple: { type: "boolean", description: "Allow multiple replacements" },
      },
      required: ["path", "target_content", "replacement_content"],
    },
  },
  {
    name: "list_directory",
    description: "List files and directories within a directory",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path relative to workspace root" },
        max_depth: { type: "number", description: "Maximum recursion depth" },
        pattern: { type: "string", description: "Optional name filter pattern" },
      },
    },
  },
  {
    name: "grep_search",
    description: "Search for a query text pattern across workspace files",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Query string or regex pattern" },
        path: { type: "string", description: "Subdirectory or file path to search" },
        is_regex: { type: "boolean", description: "Whether query is a regex pattern" },
        case_insensitive: { type: "boolean", description: "Whether search is case insensitive" },
      },
      required: ["query"],
    },
  },
  {
    name: "find_by_name",
    description: "Find files and directories matching a pattern",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Pattern to match filename" },
        path: { type: "string", description: "Directory path to search in" },
        max_depth: { type: "number", description: "Maximum directory depth" },
      },
      required: ["pattern"],
    },
  },
];
