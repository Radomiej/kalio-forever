use axum::{extract::{Path, State, ws::{Message, WebSocket, WebSocketUpgrade}}, http::StatusCode, response::{IntoResponse, Response}, routing::{get, post}, Json, Router};
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::{HashMap, VecDeque}, env, net::SocketAddr, sync::{Arc, Mutex}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use tokio::sync::{mpsc, RwLock};
use tower_http::limit::RequestBodyLimitLayer;

const MAX_FRAME: usize = 1_048_576;
const HISTORY: usize = 32;
const QUEUE: usize = 64;
const PAIR_LIMIT: usize = 2048;

#[derive(Clone, Serialize, Deserialize)]
struct Envelope { v: u8, #[serde(rename="type")] kind: String, #[serde(rename="instanceId")] instance_id: String, #[serde(default)] sequence: Option<u64>, #[serde(rename="requestId", default)] request_id: Option<String>, #[serde(default)] payload: Option<Value> }
#[derive(Clone)]
struct App(Arc<Inner>);
struct Inner { agents: HashMap<String, [u8;32]>, db: Mutex<Connection>, instances: RwLock<HashMap<String, Instance>>, pairs: Mutex<HashMap<String, Pair>> }
struct Instance { agent: Option<mpsc::Sender<String>>, devices: HashMap<String,mpsc::Sender<String>>, history: VecDeque<String>, snapshot: Option<String>, offline: bool }
struct Pair { instance: String, expires: Instant }
#[derive(Deserialize)]
struct PairRequest { code: String }
#[derive(Serialize)]
struct PairResponse { v: u8, #[serde(rename="instanceId")] instance_id: String, #[serde(rename="deviceId")] device_id: String, token: String }
#[derive(Deserialize)]
struct First { v: u8, #[serde(rename="type")] kind: String, #[serde(rename="instanceId")] instance_id: String, token: String }

fn hash(s: &str) -> [u8;32] { Sha256::digest(s.as_bytes()).into() }
fn random_hex(bytes: usize) -> String { let mut b=vec![0;bytes]; OsRng.fill_bytes(&mut b); b.iter().map(|x|format!("{x:02x}")).collect() }
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
fn error(code: StatusCode) -> Response { code.into_response() }

fn app(data: &str, config: &str) -> anyhow::Result<App> {
    let raw=env::var(config)?;
    let values: HashMap<String,String>=serde_json::from_str(&raw)?;
    if values.is_empty() { anyhow::bail!("agent configuration must not be empty") }
    let mut agents=HashMap::new();
    for (id,h) in values {
        if id.is_empty() || h.len()!=64 || !h.bytes().all(|c|c.is_ascii_hexdigit()) { anyhow::bail!("invalid agent hash for {id}") }
        let mut d=[0;32]; for (i,p) in h.as_bytes().chunks_exact(2).enumerate(){ d[i]=u8::from_str_radix(std::str::from_utf8(p)?,16)?; } agents.insert(id,d);
    }
    let db=Connection::open(data)?;
    db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS devices(instance TEXT NOT NULL, device TEXT NOT NULL, token_hash BLOB NOT NULL, PRIMARY KEY(instance,device));")?;
    Ok(App(Arc::new(Inner{agents,db:Mutex::new(db),instances:RwLock::new(HashMap::new()),pairs:Mutex::new(HashMap::new())})))
}
async fn health() -> Json<Value> { Json(json!({"ok":true})) }
async fn pair(State(app):State<App>, Json(req):Json<PairRequest>) -> Response {
    let pair={ let mut p=app.0.pairs.lock().unwrap(); p.retain(|_,v|v.expires>Instant::now()); p.remove(&req.code) };
    let Some(pair)=pair else{return error(StatusCode::UNAUTHORIZED)};
    let device=random_hex(16); let token=random_hex(32); let h=hash(&token);
    let db=app.0.db.lock().unwrap();
    if db.execute("INSERT INTO devices(instance,device,token_hash) VALUES(?1,?2,?3)",params![pair.instance,device,h.as_slice()]).is_err(){return error(StatusCode::INTERNAL_SERVER_ERROR)}
    Json(PairResponse{v:1,instance_id:pair.instance,device_id:device,token}).into_response()
}
fn bearer(headers:&HeaderMap)->Option<&str>{ headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?.strip_prefix("Bearer ") }
async fn agent_ws(Path(id):Path<String>, State(app):State<App>, ws:WebSocketUpgrade) -> Response {
    ws.max_message_size(MAX_FRAME).on_upgrade(move|socket|agent_auth(socket,app,id))
}
async fn agent_auth(mut socket:WebSocket, app:App, id:String) {
    let first=tokio::time::timeout(Duration::from_secs(5),socket.recv()).await;
    let Ok(Some(Ok(Message::Text(text))))=first else{return};
    if text.len()>MAX_FRAME{return}
    let Ok(e)=serde_json::from_str::<Envelope>(&text) else{return};
    let Some(token)=e.payload.as_ref().and_then(|p|p.get("token")).and_then(Value::as_str) else{return};
    let Some(expected)=app.0.agents.get(&id) else{return};
    if e.v!=1 || e.kind!="agent.authenticate" || e.instance_id!=id || !bool::from(subtle::ConstantTimeEq::ct_eq(&hash(token),expected)){return}
    if socket.send(Message::Text(json!({"v":1,"type":"auth.accepted","instanceId":id}).to_string().into())).await.is_err(){return}
    agent_loop(socket,app,id).await
}
async fn device_ws(State(app):State<App>, ws:WebSocketUpgrade)->Response { ws.max_message_size(MAX_FRAME).on_upgrade(move|socket|device_auth(socket,app)) }
async fn device_auth(mut socket:WebSocket, app:App) {
    let first=tokio::time::timeout(Duration::from_secs(5),socket.recv()).await;
    let Ok(Some(Ok(Message::Text(text))))=first else{return};
    let Ok(auth)=serde_json::from_str::<First>(&text) else{return};
    if auth.v!=1 || auth.kind!="auth" || auth.instance_id.is_empty(){return}
    let h=hash(&auth.token); let device_id={
        let db=app.0.db.lock().unwrap();
        db.query_row("SELECT device FROM devices WHERE instance=?1 AND token_hash=?2",params![auth.instance_id,h.as_slice()],|r|r.get::<_,String>(0)).ok()
    };
    let Some(device_id)=device_id else{return};
    device_loop(socket,app,auth.instance_id,device_id).await
}
async fn agent_loop(mut socket:WebSocket, app:App, id:String) {
    let (tx,mut rx)=mpsc::channel::<String>(QUEUE);
    { let mut all=app.0.instances.write().await; let i=all.entry(id.clone()).or_insert(Instance{agent:None,devices:HashMap::new(),history:VecDeque::new(),snapshot:None,offline:false}); i.agent=Some(tx.clone()); i.offline=false; i.snapshot=None; i.history.clear(); }
    let _=broadcast(&app,&id,json!({"v":1,"type":"instance.online","instanceId":id})).await;
    loop {
        tokio::select! {
            Some(out)=rx.recv()=> if socket.send(Message::Text(out.into())).await.is_err(){break},
            incoming=socket.recv()=> match incoming {
                Some(Ok(Message::Text(text))) if text.len()<=MAX_FRAME => {
                    let Ok(e)=serde_json::from_str::<Envelope>(&text) else {continue};
                    if e.v!=1 || e.instance_id!=id {continue}
                    if !matches!(e.kind.as_str(),"snapshot"|"session.snapshot"|"approval.result"|"pair.create") {continue}
                    if e.kind=="pair.create" {
                        let mut pairs=app.0.pairs.lock().unwrap(); pairs.retain(|_,p|p.expires>Instant::now());
                        if pairs.len()>=PAIR_LIMIT {continue}
                        let code=random_hex(16); pairs.insert(code.clone(),Pair{instance:id.clone(),expires:Instant::now()+Duration::from_secs(120)});
                        let created=Envelope{v:1,kind:"pair.created".into(),instance_id:id.clone(),sequence:None,request_id:e.request_id,payload:Some(json!({"code":code,"expiresAt":now()+120}))};
                        if let Ok(s)=serde_json::to_string(&created){if tx.try_send(s).is_err(){break}}
                        continue
                    }
                    let private=e.kind=="session.snapshot";
                    if let Ok(s)=serde_json::to_string(&e) {
                        let mut all=app.0.instances.write().await;
                        if let Some(i)=all.get_mut(&id) {
                            if e.kind=="snapshot" {i.snapshot=Some(s.clone())}
                            if !private {i.history.push_back(s.clone()); while i.history.len()>HISTORY{i.history.pop_front();}}
                        }
                        drop(all);
                        let value=serde_json::from_str(&s).unwrap_or(Value::Null);
                        if private {let _=broadcast_devices(&app,&id,s).await;} else {let _=broadcast(&app,&id,value).await;}
                    }
                },
                Some(Ok(Message::Close(_)))|None=>break,
                Some(Err(_))=>break,
                _=>{}
            }
        }
    }
    let mut all=app.0.instances.write().await;
    if let Some(i)=all.get_mut(&id) { i.agent=None; i.offline=true; }
    drop(all);
    let _=broadcast(&app,&id,json!({"v":1,"type":"instance.offline","instanceId":id})).await;
}
async fn device_loop(mut socket:WebSocket, app:App, id:String, device:String) {
    let (tx,mut rx)=mpsc::channel::<String>(QUEUE);
    let initial={
        let mut all=app.0.instances.write().await;
        let i=all.entry(id.clone()).or_insert(Instance{agent:None,devices:HashMap::new(),history:VecDeque::new(),snapshot:None,offline:true});
        i.devices.insert(device.clone(),tx); let mut h=Vec::new(); if let Some(s)=&i.snapshot{h.push(s.clone())} h.extend(i.history.iter().cloned()); h
    };
    for s in initial {if socket.send(Message::Text(s.into())).await.is_err(){return}}
    loop {
        tokio::select! {
            Some(out)=rx.recv()=> if socket.send(Message::Text(out.into())).await.is_err(){break},
            incoming=socket.recv()=> match incoming {
                Some(Ok(Message::Text(text))) if text.len()<=MAX_FRAME=>{
                    let Ok(v)=serde_json::from_str::<Value>(&text) else {continue};
                    let typ=v.get("type").and_then(Value::as_str).unwrap_or("");
                    if v.get("v")!=Some(&json!(1)) || v.get("instanceId").and_then(Value::as_str)!=Some(&id) {continue}
                    if typ=="ping" {let _=socket.send(Message::Text(json!({"v":1,"type":"pong","instanceId":id}).to_string().into())).await;continue}
                    if typ=="session.watch" {
                        if v.get("sessionId").and_then(Value::as_str).is_none() || v.get("requestId").and_then(Value::as_str).is_none(){continue}
                    } else if typ=="approval.decide" {
                        if !matches!(v.get("decision").and_then(Value::as_str),Some("approve"|"deny"))
                            || ["requestId","approvalId","revision","argsSha256"].iter().any(|k|v.get(*k).and_then(Value::as_str).is_none()){continue}
                    } else {continue}
                    let all=app.0.instances.read().await;
                    let Some(i)=all.get(&id) else{continue};
                    if i.offline {
                        if typ=="approval.decide" {let _=socket.send(Message::Text(json!({"v":1,"type":"approval.rejected","instanceId":id,"requestId":v.get("requestId"),"reason":"instance_offline"}).to_string().into())).await;}
                        continue
                    }
                    let clean=if typ=="session.watch" {json!({"v":1,"type":typ,"instanceId":id,"requestId":v["requestId"],"sessionId":v["sessionId"]})}
                        else {json!({"v":1,"type":typ,"instanceId":id,"requestId":v["requestId"],"approvalId":v["approvalId"],"revision":v["revision"],"argsSha256":v["argsSha256"],"decision":v["decision"]})};
                    if let Some(agent)=&i.agent {if agent.try_send(clean.to_string()).is_err(){break}}
                },
                Some(Ok(Message::Close(_)))|None=>break,
                Some(Err(_))=>break,
                _=>{}
            }
        }
    }
    if let Some(i)=app.0.instances.write().await.get_mut(&id){i.devices.remove(&device);}
}
async fn broadcast(app:&App,id:&str,v:Value)->Result<(),()> {broadcast_serialized(app,id,v.to_string()).await}
async fn broadcast_devices(app:&App,id:&str,s:String)->Result<(),()> {broadcast_serialized(app,id,s).await}
async fn broadcast_serialized(app:&App,id:&str,s:String)->Result<(),()> {
    let mut all=app.0.instances.write().await;
    let Some(i)=all.get_mut(id) else{return Ok(())};
    let slow:Vec<String>=i.devices.iter().filter_map(|(d,tx)|tx.try_send(s.clone()).err().map(|_|d.clone())).collect();
    for d in slow{i.devices.remove(&d);} Ok(())
}
#[tokio::main]
async fn main()->anyhow::Result<()> {
    let data=env::var("KALIO_RELAY_DATA").unwrap_or_else(|_|"relay.sqlite".into());
    let app=app(&data,"KALIO_RELAY_AGENTS_JSON")?;
    let router=Router::new().route("/healthz",get(health)).route("/v1/pair",post(pair))
      .route("/v1/agent/{instance}",get(agent_ws)).route("/v1/device",get(device_ws))
      .layer(RequestBodyLimitLayer::new(MAX_FRAME)).with_state(app);
    let addr:SocketAddr=env::var("KALIO_RELAY_BIND").unwrap_or_else(|_|"127.0.0.1:8787".into()).parse()?;
    axum::serve(tokio::net::TcpListener::bind(addr).await?,router).await?; Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn token_hash_is_stable_and_256_bit() { assert_eq!(hash("token"),hash("token")); assert_ne!(hash("token"),hash("other")); }
    #[test] fn pair_codes_have_128_bits_and_device_tokens_256_bits() { assert_eq!(random_hex(16).len(),32); assert_eq!(random_hex(32).len(),64); }
    #[test] fn envelope_does_not_require_payload() {
        let e:Envelope=serde_json::from_str(r#"{"v":1,"type":"snapshot","instanceId":"desk"}"#).unwrap();
        assert_eq!(e.instance_id,"desk"); assert_eq!(e.payload,None);
    }
}
