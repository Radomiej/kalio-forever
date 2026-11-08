use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Envelope {
    pub(crate) v: u8,
    #[serde(rename = "type")]
    pub(crate) kind: String,
    #[serde(rename = "instanceId")]
    pub(crate) instance_id: String,
    #[serde(default)]
    pub(crate) sequence: Option<u64>,
    #[serde(rename = "requestId", default)]
    pub(crate) request_id: Option<String>,
    #[serde(default)]
    pub(crate) payload: Option<Value>,
}
#[derive(Deserialize)]
pub(crate) struct PairRequest {
    pub(crate) code: String,
}
#[derive(Serialize)]
pub(crate) struct PairResponse {
    pub(crate) v: u8,
    #[serde(rename = "instanceId")]
    pub(crate) instance_id: String,
    #[serde(rename = "deviceId")]
    pub(crate) device_id: String,
    pub(crate) token: String,
}
#[derive(Deserialize)]
pub(crate) struct First {
    pub(crate) v: u8,
    #[serde(rename = "type")]
    pub(crate) kind: String,
    #[serde(rename = "instanceId")]
    pub(crate) instance_id: String,
    pub(crate) token: String,
}
