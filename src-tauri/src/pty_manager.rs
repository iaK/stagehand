use portable_pty::{Child, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::Write;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

pub struct PtyEntry {
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send>,
    pub master_pty: Box<dyn MasterPty + Send>,
    pub kill_tx: Option<oneshot::Sender<()>>,
}

#[derive(Clone)]
pub struct PtyManager {
    pub sessions: Arc<Mutex<HashMap<String, PtyEntry>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn register(&self, id: String, entry: PtyEntry) {
        let mut sessions = self.sessions.lock().await;
        sessions.insert(id, entry);
    }

    pub async fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        if let Some(entry) = sessions.get_mut(id) {
            entry
                .writer
                .write_all(data)
                .map_err(|e| format!("Write failed: {}", e))?;
            entry
                .writer
                .flush()
                .map_err(|e| format!("Flush failed: {}", e))?;
            Ok(())
        } else {
            Err("PTY session not found".to_string())
        }
    }

    pub async fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        if let Some(entry) = sessions.get(id) {
            entry
                .master_pty
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| format!("Resize failed: {}", e))
        } else {
            Err("PTY session not found".to_string())
        }
    }

    pub async fn kill(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        if let Some(entry) = sessions.get_mut(id) {
            if let Some(tx) = entry.kill_tx.take() {
                tx.send(()).map_err(|_| "PTY already exited".to_string())?;
            }
            Ok(())
        } else {
            Err("PTY session not found".to_string())
        }
    }

    pub async fn remove(&self, id: &str) {
        let mut sessions = self.sessions.lock().await;
        sessions.remove(id);
    }

    pub async fn kill_all(&self) {
        let mut sessions = self.sessions.lock().await;
        for (_id, entry) in sessions.iter_mut() {
            if let Some(tx) = entry.kill_tx.take() {
                let _ = tx.send(());
            }
        }
        sessions.clear();
    }
}
