use crate::{protocol::*, state::*};
use axum::{extract::{State, ws::{Message, WebSocket}}, http::{Method, StatusCode, header::CONTENT_TYPE}, response::{IntoResponse, Response}, routing::{get, post}, Json, Router};
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, env, net::SocketAddr, sync::{Arc, Mutex}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use tokio::sync::{RwLock, Semaphore};
use tower_http::{cors::{AllowOrigin, CorsLayer}, limit::RequestBodyLimitLayer};
pub(crate) const MAX_FRAME: usize = 1_048_576;
pub(crate) const HISTORY: usize = 32;
pub(crate) const QUEUE: usize = 64;
pub(crate) const PAIR_LIMIT: usize = 2048;

pub(crate) fn hash(s: &str) -> [u8;32] { Sha256::digest(s.as_bytes()).into() }
pub(crate) fn random_hex(bytes: usize) -> String { let mut b=vec![0;bytes]; OsRng.fill_bytes(&mut b); b.iter().map(|x|format!("{x:02x}")).collect() }
pub(crate) fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
pub(crate) fn error(code: StatusCode) -> Response { code.into_response() }

fn app(data: &str, config: &str) -> anyhow::Result<App> {
    let raw=env::var(config)?;
    let values: HashMap<String,String>=serde_json::from_str(&raw)?;
    if values.is_empty() { anyhow::bail!("agent configuration must not be empty") }
    let mut agents=HashMap::new();
    for (id,h) in values {
        if id.is_empty() || h.len()!=64 || !h.bytes().all(|c|c.is_ascii_hexdigit()) { anyhow::bail!("invalid agent hash for {id}") }
        let mut d=[0;32]; for (i,p) in h.as_bytes().chunks_exact(2).enumerate(){ d[i]=u8::from_str_radix(std::str::from_utf8(p)?,16)?; } agents.insert(id,d);
    }
    let allowed_origins:Vec<String>=match env::var("KALIO_RELAY_ALLOWED_ORIGINS"){Ok(v)=>serde_json::from_str(&v)?,Err(_)=>vec!["https://localhost".into(),"http://localhost".into()]};
    if allowed_origins.is_empty() || allowed_origins.iter().any(|o|o=="*" || (!o.starts_with("http://") && !o.starts_with("https://"))){anyhow::bail!("KALIO_RELAY_ALLOWED_ORIGINS must be a JSON list of explicit HTTP(S) origins") }
    let db=Connection::open(data)?;
    db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS devices(instance TEXT NOT NULL, device TEXT NOT NULL, token_hash BLOB NOT NULL, PRIMARY KEY(instance,device));")?;
    Ok(App(Arc::new(Inner{allowed_origins,preauth:Arc::new(Semaphore::new(256)),agents,db:Mutex::new(db),instances:RwLock::new(HashMap::new()),pairs:Mutex::new(HashMap::new())})))
}
pub(crate) async fn send_socket(socket:&mut WebSocket, message:Message)->bool { matches!(tokio::time::timeout(Duration::from_secs(5),socket.send(message)).await,Ok(Ok(()))) }
pub(crate) async fn health() -> Json<Value> { Json(json!({"ok":true})) }
pub(crate) async fn pair(State(app):State<App>, Json(req):Json<PairRequest>) -> Response {
    let pair={ let mut p=app.0.pairs.lock().unwrap(); p.retain(|_,v|v.expires>Instant::now()); p.remove(&req.code) };
    let Some(pair)=pair else{return error(StatusCode::UNAUTHORIZED)};
    let device=random_hex(16); let token=random_hex(32); let h=hash(&token);
    let db=app.0.db.lock().unwrap();
    if db.execute("INSERT INTO devices(instance,device,token_hash) VALUES(?1,?2,?3)",params![pair.instance,device,h.as_slice()]).is_err(){return error(StatusCode::INTERNAL_SERVER_ERROR)}
    Json(PairResponse{v:1,instance_id:pair.instance,device_id:device,token}).into_response()
}
pub(crate) async fn broadcast(app:&App,id:&str,v:Value)->Result<(),()> {broadcast_serialized(app,id,v.to_string()).await}
pub(crate) async fn broadcast_devices(app:&App,id:&str,s:String)->Result<(),()> {broadcast_serialized(app,id,s).await}
async fn broadcast_serialized(app:&App,id:&str,s:String)->Result<(),()> {
    let mut all=app.0.instances.write().await;
    let Some(i)=all.get_mut(id) else{return Ok(())};
    let slow:Vec<String>=i.devices.iter().filter_map(|(d,tx)|tx.try_send(s.clone()).err().map(|_|d.clone())).collect();
    for d in slow{ i.devices.remove(&d); if let Some(cancel)=i.device_cancel.remove(&d){let _=cancel.send(true);} } Ok(())
}
pub async fn run()->anyhow::Result<()> {
    let data=env::var("KALIO_RELAY_DATA").unwrap_or_else(|_|"relay.sqlite".into());
    let app=app(&data,"KALIO_RELAY_AGENTS_JSON")?;
    let cors=CorsLayer::new().allow_origin(AllowOrigin::list(app.0.allowed_origins.iter().map(|o|o.parse().expect("validated origin"))))
        .allow_methods([Method::GET,Method::POST,Method::OPTIONS]).allow_headers([CONTENT_TYPE]);
    let router=Router::new().route("/healthz",get(health)).route("/v1/pair",post(pair))
      .route("/v1/agent/{instance}",get(crate::agent::agent_ws)).route("/v1/device",get(crate::device::device_ws))
      .layer(cors).layer(RequestBodyLimitLayer::new(MAX_FRAME)).with_state(app);
    let addr:SocketAddr=env::var("KALIO_RELAY_BIND").unwrap_or_else(|_|"127.0.0.1:8787".into()).parse()?;
    axum::serve(tokio::net::TcpListener::bind(addr).await?,router).await?; Ok(())
}
