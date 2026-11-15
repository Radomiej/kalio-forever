use crate::protocol::Envelope;
use rusqlite::Connection;
use std::{
    collections::HashMap,
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
#[derive(Default)]
pub(crate) struct Instance {
    pub(crate) agent_generation: u64,
    pub(crate) agent_cancel: Option<watch::Sender<bool>>,
    pub(crate) agent: Option<mpsc::Sender<String>>,
    pub(crate) device_generation: HashMap<String, u64>,
    pub(crate) device_cancel: HashMap<String, watch::Sender<bool>>,
    pub(crate) devices: HashMap<String, mpsc::Sender<DeviceFrame>>,
    pub(crate) watches: HashMap<String, SessionWatch>,
    pub(crate) snapshot: Option<String>,
    pub(crate) offline: bool,
}
pub(crate) enum DeviceFrame {
    General(String),
    Watch(Envelope),
    WatchError { generation: u64, frame: String },
}

pub(crate) struct SessionWatch {
    pub(crate) client_id: String,
    pub(crate) host_id: String,
}

impl Instance {
    pub(crate) fn enqueue(&mut self, instance_id: &str, device: &str, frame: DeviceFrame) {
        if self
            .devices
            .get(device)
            .is_some_and(|tx| tx.try_send(frame).is_err())
        {
            self.devices.remove(device);
            self.clear_watch(instance_id, device);
            if let Some(cancel) = self.device_cancel.remove(device) {
                let _ = cancel.send(true);
            }
        }
    }

    pub(crate) fn broadcast(&mut self, instance_id: &str, frame: String) {
        for device in self.devices.keys().cloned().collect::<Vec<_>>() {
            self.enqueue(instance_id, &device, DeviceFrame::General(frame.clone()));
        }
    }

    pub(crate) fn forward(&self, frame: String) -> Result<(), &'static str> {
        let Some(agent) = &self.agent else {
            return Err("instance_offline");
        };
        if self
            .agent_cancel
            .as_ref()
            .is_some_and(|cancel| *cancel.borrow())
        {
            return Err("relay_busy");
        }
        agent.try_send(frame).map_err(|_| "relay_busy")
    }

    pub(crate) fn clear_watch(&mut self, instance_id: &str, device: &str) {
        if self.watches.remove(device).is_none() {
            return;
        }
        let Some(agent) = &self.agent else { return };
        let frame = serde_json::json!({
            "v":1,"type":"session.unwatch","instanceId":instance_id,"payload":{"deviceId":device}
        });
        // A dropped unwatch would consume a host watch slot until it reconnects.
        if agent.try_send(frame.to_string()).is_err() {
            if let Some(cancel) = &self.agent_cancel {
                let _ = cancel.send(true);
            }
        }
    }
}

pub(crate) struct Pair {
    pub(crate) instance: String,
    pub(crate) expires: Instant,
}
