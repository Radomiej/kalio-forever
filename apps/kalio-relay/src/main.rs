use axum::{extract::{Path, State, ws::{Message, WebSocket, WebSocketUpgrade}}, http::{HeaderMap, Method, StatusCode, header::{CONTENT_TYPE, ORIGIN}}, response::{IntoResponse, Response}, routing::{get, post}, Json, Router};
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::{HashMap, VecDeque}, env, net::SocketAddr, sync::{Arc, Mutex}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use tokio::sync::{mpsc, watch, RwLock, Semaphore};
use tower_http::{cors::{AllowOrigin, CorsLayer}, limit::RequestBodyLimitLayer};

const MAX_FRAME: usize = 1_048_576;
const HISTORY: usize = 32;
const QUEUE: usize = 64;
const PAIR_LIMIT: usize = 2048;

#[derive(Clone, Serialize, Deserialize)]
struct Envelope { v: u8, #[serde(rename="type")] kind: String, #[serde(rename="instanceId")] instance_id: String, #[serde(default)] sequence: Option<u64>, #[serde(rename="requestId", default)] request_id: Option<String>, #[serde(default)] payload: Option<Value> }
#[derive(Clone)]
struct App(Arc<Inner>);
struct Inner { allowed_origins: Vec<String>, preauth: Arc<Semaphore>, agents: HashMap<String, [u8;32]>, db: Mutex<Connection>, instances: RwLock<HashMap<String, Instance>>, pairs: Mutex<HashMap<String, Pair>> }
struct Instance { agent_generation: u64, agent_cancel: Option<watch::Sender<bool>>, agent: Option<mpsc::Sender<String>>, device_generation: HashMap<String,u64>, device_cancel: HashMap<String,watch::Sender<bool>>, devices: HashMap<String,mpsc::Sender<String>>, history: VecDeque<String>, snapshot: Option<String>, offline: bool }
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
    let allowed_origins:Vec<String>=match env::var("KALIO_RELAY_ALLOWED_ORIGINS"){Ok(v)=>serde_json::from_str(&v)?,Err(_)=>vec!["https://localhost".into(),"http://localhost".into()]};
    if allowed_origins.is_empty() || allowed_origins.iter().any(|o|o=="*" || (!o.starts_with("http://") && !o.starts_with("https://"))){anyhow::bail!("KALIO_RELAY_ALLOWED_ORIGINS must be a JSON list of explicit HTTP(S) origins") }
    let db=Connection::open(data)?;
    db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS devices(instance TEXT NOT NULL, device TEXT NOT NULL, token_hash BLOB NOT NULL, PRIMARY KEY(instance,device));")?;
    Ok(App(Arc::new(Inner{allowed_origins,preauth:Arc::new(Semaphore::new(256)),agents,db:Mutex::new(db),instances:RwLock::new(HashMap::new()),pairs:Mutex::new(HashMap::new())})))
}
async fn send_socket(socket:&mut WebSocket, message:Message)->bool { matches!(tokio::time::timeout(Duration::from_secs(5),socket.send(message)).await,Ok(Ok(()))) }
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
async fn agent_auth(mut socket:WebSocket, app:App, id:String, _permit:tokio::sync::OwnedSemaphorePermit) {
    let first=tokio::time::timeout(Duration::from_secs(5),socket.recv()).await;
    let Ok(Some(Ok(Message::Text(text))))=first else{return};
    if text.len()>MAX_FRAME{return}
    let Ok(e)=serde_json::from_str::<Envelope>(&text) else{return};
    let Some(token)=e.payload.as_ref().and_then(|p|p.get("token")).and_then(Value::as_str) else{return};
    let Some(expected)=app.0.agents.get(&id) else{return};
    if e.v!=1 || e.kind!="agent.authenticate" || e.instance_id!=id || !bool::from(subtle::ConstantTimeEq::ct_eq(&hash(token),expected)){return}
    if !send_socket(&mut socket,Message::Text(json!({"v":1,"type":"auth.accepted","instanceId":id}).to_string().into())).await{return}
    agent_loop(socket,app,id).await
}
async fn device_ws(State(app):State<App>, headers:HeaderMap, ws:WebSocketUpgrade)->Response { if let Some(origin)=headers.get(ORIGIN).and_then(|h|h.to_str().ok()){if !app.0.allowed_origins.iter().any(|allowed|allowed==origin){return error(StatusCode::FORBIDDEN)}} let Ok(permit)=app.0.preauth.clone().try_acquire_owned() else{return error(StatusCode::SERVICE_UNAVAILABLE)}; ws.max_message_size(MAX_FRAME).on_upgrade(move|socket|device_auth(socket,app,permit)) }
async fn device_auth(mut socket:WebSocket, app:App, _permit:tokio::sync::OwnedSemaphorePermit) {
    let first=tokio::time::timeout(Duration::from_secs(5),socket.recv()).await;
    let Ok(Some(Ok(Message::Text(text))))=first else{return};
    let Ok(auth)=serde_json::from_str::<First>(&text) else{return};
    if auth.v!=1 || auth.kind!="auth" || auth.instance_id.is_empty(){return}
    let h=hash(&auth.token); let device_id={
        let db=app.0.db.lock().unwrap();
        db.query_row("SELECT device FROM devices WHERE instance=?1 AND token_hash=?2",params![auth.instance_id,h.as_slice()],|r|r.get::<_,String>(0)).ok()
    };
    let Some(device_id)=device_id else{return};
    if !send_socket(&mut socket,Message::Text(json!({"v":1,"type":"auth.accepted","instanceId":auth.instance_id}).to_string().into())).await{return}
    device_loop(socket,app,auth.instance_id,device_id).await
}
async fn agent_loop(mut socket:WebSocket, app:App, id:String) {
    let (tx,mut rx)=mpsc::channel::<String>(QUEUE);
    let (cancel_tx,mut cancel_rx)=watch::channel(false);
    let generation={ let mut all=app.0.instances.write().await; let i=all.entry(id.clone()).or_insert(Instance{agent_generation:0,agent_cancel:None,agent:None,device_generation:HashMap::new(),device_cancel:HashMap::new(),devices:HashMap::new(),history:VecDeque::new(),snapshot:None,offline:false});
        if let Some(old)=i.agent_cancel.take(){let _=old.send(true);}
        i.agent_generation+=1; let gen=i.agent_generation; i.agent_cancel=Some(cancel_tx); i.agent=Some(tx.clone()); i.offline=false; i.snapshot=None; i.history.clear(); gen };
    let _=broadcast(&app,&id,json!({"v":1,"type":"instance.online","instanceId":id})).await;
    loop {
        tokio::select! {
            _=cancel_rx.changed()=>{let _=send_socket(&mut socket,Message::Close(None)).await;break},
            out=rx.recv()=> match out {Some(out)=>if !send_socket(&mut socket,Message::Text(out.into())).await{break},None=>break},
            incoming=socket.recv()=> match incoming {
                Some(Ok(Message::Text(text))) if text.len()<=MAX_FRAME => {
                    let Ok(e)=serde_json::from_str::<Envelope>(&text) else {continue};
                    if e.v!=1 || e.instance_id!=id {continue}
                    if !app.0.instances.read().await.get(&id).is_some_and(|i|i.agent_generation==generation){break}
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
                            if i.agent_generation!=generation {continue}
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
    let current=if let Some(i)=all.get_mut(&id) { if i.agent_generation==generation {i.agent=None;i.agent_cancel=None;i.offline=true;true} else {false} } else {false};
    drop(all);
    if current {let _=broadcast(&app,&id,json!({"v":1,"type":"instance.offline","instanceId":id})).await;}
}
async fn device_loop(mut socket:WebSocket, app:App, id:String, device:String) {
    let (tx,mut rx)=mpsc::channel::<String>(QUEUE);
    let (cancel_tx,mut cancel_rx)=watch::channel(false);
    let (generation,initial)={
        let mut all=app.0.instances.write().await;
        let i=all.entry(id.clone()).or_insert(Instance{agent_generation:0,agent_cancel:None,agent:None,device_generation:HashMap::new(),device_cancel:HashMap::new(),devices:HashMap::new(),history:VecDeque::new(),snapshot:None,offline:true});
        if let Some(old)=i.device_cancel.remove(&device){let _=old.send(true);}
        let gen=i.device_generation.get(&device).copied().unwrap_or(0)+1;
        i.device_generation.insert(device.clone(),gen); i.device_cancel.insert(device.clone(),cancel_tx);
        i.devices.insert(device.clone(),tx); let mut h=Vec::new(); if let Some(s)=&i.snapshot{h.push(s.clone())} h.extend(i.history.iter().cloned()); (gen,h)
    };
    for s in initial {if !send_socket(&mut socket,Message::Text(s.into())).await{if let Some(i)=app.0.instances.write().await.get_mut(&id){if i.device_generation.get(&device)==Some(&generation){i.devices.remove(&device);i.device_cancel.remove(&device);}}return}}
    loop {
        tokio::select! {
            _=cancel_rx.changed()=>{let _=socket.send(Message::Close(None)).await;break},
            out=rx.recv()=> match out {Some(out)=>if socket.send(Message::Text(out.into())).await.is_err(){break},None=>break},
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
    if let Some(i)=app.0.instances.write().await.get_mut(&id){if i.device_generation.get(&device)==Some(&generation){i.devices.remove(&device);i.device_cancel.remove(&device);}}
}
async fn broadcast(app:&App,id:&str,v:Value)->Result<(),()> {broadcast_serialized(app,id,v.to_string()).await}
async fn broadcast_devices(app:&App,id:&str,s:String)->Result<(),()> {broadcast_serialized(app,id,s).await}
async fn broadcast_serialized(app:&App,id:&str,s:String)->Result<(),()> {
    let mut all=app.0.instances.write().await;
    let Some(i)=all.get_mut(id) else{return Ok(())};
    let slow:Vec<String>=i.devices.iter().filter_map(|(d,tx)|tx.try_send(s.clone()).err().map(|_|d.clone())).collect();
    for d in slow{ i.devices.remove(&d); if let Some(cancel)=i.device_cancel.remove(&d){let _=cancel.send(true);} } Ok(())
}
#[tokio::main]
async fn main()->anyhow::Result<()> {
    let data=env::var("KALIO_RELAY_DATA").unwrap_or_else(|_|"relay.sqlite".into());
    let app=app(&data,"KALIO_RELAY_AGENTS_JSON")?;
    let cors=CorsLayer::new().allow_origin(AllowOrigin::list(app.0.allowed_origins.iter().map(|o|o.parse().expect("validated origin"))))
        .allow_methods([Method::GET,Method::POST,Method::OPTIONS]).allow_headers([CONTENT_TYPE]);
    let router=Router::new().route("/healthz",get(health)).route("/v1/pair",post(pair))
      .route("/v1/agent/{instance}",get(agent_ws)).route("/v1/device",get(device_ws))
      .layer(cors).layer(RequestBodyLimitLayer::new(MAX_FRAME)).with_state(app);
    let addr:SocketAddr=env::var("KALIO_RELAY_BIND").unwrap_or_else(|_|"127.0.0.1:8787".into()).parse()?;
    axum::serve(tokio::net::TcpListener::bind(addr).await?,router).await?; Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::{connect_async, tungstenite::Message as ClientMessage};

    async fn test_server() -> (String, tokio::task::JoinHandle<()>, App) {
        let db=Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE devices(instance TEXT NOT NULL, device TEXT NOT NULL, token_hash BLOB NOT NULL, PRIMARY KEY(instance,device));").unwrap();
        let app=App(Arc::new(Inner {
            allowed_origins:vec!["https://localhost".into(),"http://localhost".into()],preauth:Arc::new(Semaphore::new(32)),
            agents:HashMap::from([("desk".to_string(),hash("agent-secret"))]),
            db:Mutex::new(db),
            instances:RwLock::new(HashMap::new()),
            pairs:Mutex::new(HashMap::new()),
        }));
        let router=Router::new().route("/healthz",get(health)).route("/v1/pair",post(pair))
            .route("/v1/agent/{instance}",get(agent_ws)).route("/v1/device",get(device_ws)).layer(CorsLayer::new().allow_origin(AllowOrigin::list(app.0.allowed_origins.iter().map(|o|o.parse().unwrap()))).allow_methods([Method::GET,Method::POST,Method::OPTIONS]).allow_headers([CONTENT_TYPE])).with_state(app.clone());
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address=listener.local_addr().unwrap();
        let task=tokio::spawn(async move {let _=axum::serve(listener,router).await;});
        (format!("ws://{address}"),task,app)
    }
    async fn auth_agent(base:&str) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
        let (mut ws,_)=connect_async(format!("{base}/v1/agent/desk")).await.unwrap();
        ws.send(ClientMessage::Text(json!({"v":1,"type":"agent.authenticate","instanceId":"desk","payload":{"token":"agent-secret"}}).to_string().into())).await.unwrap();
        let frame=tokio::time::timeout(Duration::from_secs(2),ws.next()).await.unwrap().unwrap().unwrap();
        assert!(frame.into_text().unwrap().contains("auth.accepted"));
        ws
    }
    async fn auth_device(base:&str, token:&str) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
        let (mut ws,_)=connect_async(format!("{base}/v1/device")).await.unwrap();
        ws.send(ClientMessage::Text(json!({"v":1,"type":"auth","instanceId":"desk","token":token}).to_string().into())).await.unwrap();
        let frame=tokio::time::timeout(Duration::from_secs(2),ws.next()).await.unwrap().unwrap().unwrap();
        assert!(frame.into_text().unwrap().contains("auth.accepted"));
        ws
    }
    #[tokio::test]
    async fn replacing_agent_closes_old_socket_without_offlining_new_agent() {
        let (base,server,app)=test_server().await;
        let mut old=auth_agent(&base).await;
        let mut new=auth_agent(&base).await;
        let ended=tokio::time::timeout(Duration::from_secs(2),old.next()).await.unwrap();
        assert!(matches!(ended, Ok(None) | Ok(Some(Err(_))) | Ok(Some(Ok(ClientMessage::Close(_))))));
        let state=app.0.instances.read().await;
        let current=state.get("desk").unwrap();
        assert!(!current.offline);
        assert!(current.agent.is_some());
        drop(state);
        new.close().await.unwrap();
        server.abort();
    }
    #[tokio::test]
    async fn replacing_device_closes_only_the_old_connection() {
        let (base,server,app)=test_server().await;
        app.0.db.lock().unwrap().execute("INSERT INTO devices(instance,device,token_hash) VALUES(?1,?2,?3)",params!["desk","phone",hash("device-secret").as_slice()]).unwrap();
        let mut old=auth_device(&base,"device-secret").await;
        let mut new=auth_device(&base,"device-secret").await;
        let ended=tokio::time::timeout(Duration::from_secs(2),old.next()).await.unwrap();
        assert!(matches!(ended, Ok(None) | Ok(Some(Err(_))) | Ok(Some(Ok(ClientMessage::Close(_))))));
        let state=app.0.instances.read().await;
        assert!(state.get("desk").unwrap().devices.contains_key("phone"));
        drop(state);
        new.close().await.unwrap();
        server.abort();
    }
    #[tokio::test]
    async fn cors_allows_configured_origin_and_rejects_other_origins() {
        let (base,server,_)=test_server().await;
        let http=base.replacen("ws://","http://",1);
        let client=reqwest::Client::new();
        let allowed=client.request(reqwest::Method::OPTIONS,format!("{http}/v1/pair"))
            .header("origin","https://localhost")
            .header("access-control-request-method","POST")
            .header("access-control-request-headers","content-type")
            .send().await.unwrap();
        assert_eq!(allowed.headers().get("access-control-allow-origin").unwrap(),"https://localhost");
        assert!(allowed.headers().get("access-control-allow-methods").unwrap().to_str().unwrap().contains("POST"));
        let blocked=client.request(reqwest::Method::OPTIONS,format!("{http}/v1/pair"))
            .header("origin","https://attacker.example")
            .header("access-control-request-method","POST")
            .send().await.unwrap();
        assert!(blocked.headers().get("access-control-allow-origin").is_none());
        server.abort();
    }

}