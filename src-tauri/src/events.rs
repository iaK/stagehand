use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClaudeStreamEvent {
    #[serde(rename = "started")]
    Started {
        process_id: String,
        session_id: Option<String>,
    },
    #[serde(rename = "stdout_line")]
    StdoutLine { line: String },
    #[serde(rename = "stderr_line")]
    StderrLine { line: String },
    #[serde(rename = "completed")]
    Completed {
        process_id: String,
        exit_code: Option<i32>,
    },
}
