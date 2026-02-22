use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentStreamEvent {
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
    #[serde(rename = "error")]
    Error {
        process_id: String,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PtyEvent {
    #[serde(rename = "started")]
    Started { id: String },
    #[serde(rename = "output")]
    Output { data: String },
    #[serde(rename = "exited")]
    Exited { id: String, exit_code: Option<i32> },
    #[serde(rename = "error")]
    Error { id: String, message: String },
}
