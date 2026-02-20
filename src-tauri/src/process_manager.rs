use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

pub struct ProcessEntry {
    pub kill_tx: Option<oneshot::Sender<()>>,
    pub stage_execution_id: Option<String>,
}

#[derive(Clone)]
pub struct ProcessManager {
    processes: Arc<Mutex<HashMap<String, ProcessEntry>>>,
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn register(
        &self,
        process_id: String,
        kill_tx: oneshot::Sender<()>,
        stage_execution_id: Option<String>,
    ) {
        let mut procs = self.processes.lock().await;
        procs.insert(
            process_id,
            ProcessEntry {
                kill_tx: Some(kill_tx),
                stage_execution_id,
            },
        );
    }

    pub async fn remove(&self, process_id: &str) {
        let mut procs = self.processes.lock().await;
        procs.remove(process_id);
    }

    pub async fn kill(&self, process_id: &str) -> Result<(), String> {
        let mut procs = self.processes.lock().await;
        if let Some(entry) = procs.get_mut(process_id) {
            if let Some(tx) = entry.kill_tx.take() {
                tx.send(()).map_err(|_| "Process already exited".to_string())?;
                Ok(())
            } else {
                Err("Kill signal already sent".to_string())
            }
        } else {
            Err("Process not found".to_string())
        }
    }

    pub async fn kill_all(&self) {
        let mut procs = self.processes.lock().await;
        for (_id, entry) in procs.iter_mut() {
            if let Some(tx) = entry.kill_tx.take() {
                let _ = tx.send(());
            }
        }
        procs.clear();
    }

    pub async fn list_running(&self) -> Vec<String> {
        let procs = self.processes.lock().await;
        procs.keys().cloned().collect()
    }

    pub async fn list_running_detailed(&self) -> Vec<(String, Option<String>)> {
        let procs = self.processes.lock().await;
        procs
            .iter()
            .map(|(id, entry)| (id.clone(), entry.stage_execution_id.clone()))
            .collect()
    }
}
