#!/usr/bin/env node

/**
 * Stagehand Context MCP Server
 *
 * Provides on-demand access to prior stage data for pipeline stages.
 * Runs as a stdio MCP server, opened by Claude CLI via --mcp-config.
 *
 * Environment variables:
 *   STAGEHAND_DB_PATH  — absolute path to the project SQLite DB
 *   STAGEHAND_TASK_ID  — current task ID
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import Database from "better-sqlite3";
import { z } from "zod";

const dbPath = process.env.STAGEHAND_DB_PATH;
const taskId = process.env.STAGEHAND_TASK_ID;

if (!dbPath || !taskId) {
  console.error(
    "STAGEHAND_DB_PATH and STAGEHAND_TASK_ID environment variables are required",
  );
  process.exit(1);
}

// Open DB in readonly mode — no locking conflicts with the main app
const db = new Database(dbPath, { readonly: true });
db.pragma("busy_timeout = 5000");

const server = new McpServer({
  name: "stagehand-context",
  version: "0.1.0",
});

// --- Tools ---

server.tool(
  "list_completed_stages",
  "List all completed (approved) stages for the current task, with their names and summaries.",
  {},
  async () => {
    const rows = db
      .prepare(
        `SELECT st.name, se.stage_summary
         FROM stage_executions se
         JOIN stage_templates st ON se.stage_template_id = st.id
         WHERE se.task_id = ? AND se.status = 'approved'
           AND se.stage_result IS NOT NULL AND se.stage_result != ''
         ORDER BY st.sort_order ASC`,
      )
      .all(taskId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            rows.map((r) => ({ name: r.name, summary: r.stage_summary || "" })),
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.tool(
  "get_stage_output",
  "Get the full output (stage_result) of a completed stage by name.",
  { stage_name: z.string().describe("The name of the stage to retrieve output for") },
  async ({ stage_name }) => {
    const row = db
      .prepare(
        `SELECT se.stage_result
         FROM stage_executions se
         JOIN stage_templates st ON se.stage_template_id = st.id
         WHERE se.task_id = ? AND st.name = ? AND se.status = 'approved'
           AND se.stage_result IS NOT NULL AND se.stage_result != ''
         ORDER BY se.attempt_number DESC
         LIMIT 1`,
      )
      .get(taskId, stage_name);

    if (!row) {
      return {
        content: [
          {
            type: "text",
            text: `No approved output found for stage "${stage_name}"`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: row.stage_result }],
    };
  },
);

server.tool(
  "get_task_title",
  "Get the current task's title.",
  {},
  async () => {
    const row = db
      .prepare("SELECT title FROM tasks WHERE id = ?")
      .get(taskId);

    if (!row) {
      return {
        content: [{ type: "text", text: "Task not found" }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { title: row.title },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
