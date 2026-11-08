use rusqlite::Connection;
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
    time::Instant,
};
use tokio::sync::{mpsc, watch, RwLock, Semaphore};

#[derive(Clone)]
pub(crate) struct App(pub(crate) Arc<Inner>);
pub(crate) struct Inner {
    pub(crate) allowed_origins: Vec<String>,
    pub(crate) preauth: Arc<Semaphore>,
    pub(crate) agents: HashMap<String, [u8; 32]>,
    pub(crate) db: Mutex<Connection>,
    pub(crate) instances: RwLock<HashMap<String, Instance>>,
    pub(crate) pairs: Mutex<HashMap<String, Pair>>,
}
pub(crate) struct Instance {
    pub(crate) agent_generation: u64,
    pub(crate) agent_cancel: Option<watch::Sender<bool>>,
    pub(crate) agent: Option<mpsc::Sender<String>>,
    pub(crate) device_generation: HashMap<String, u64>,
    pub(crate) device_cancel: HashMap<String, watch::Sender<bool>>,
    pub(crate) devices: HashMap<String, mpsc::Sender<String>>,
    pub(crate) history: VecDeque<String>,
    pub(crate) snapshot: Option<String>,
    pub(crate) offline: bool,
}
pub(crate) struct Pair {
    pub(crate) instance: String,
    pub(crate) expires: Instant,
}
