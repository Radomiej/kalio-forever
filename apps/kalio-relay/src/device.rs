use crate::{protocol::*, state::*, relay::{error,hash,send_socket,MAX_FRAME,QUEUE}};
use axum::{extract::{State, ws::{Message, WebSocket, WebSocketUpgrade}}, http::{HeaderMap, StatusCode, header::ORIGIN}, response::Response};
use rusqlite::params;
use serde_json::{json, Value};
use std::{collections::{HashMap,VecDeque},time::Duration};
use tokio::sync::{mpsc, watch, OwnedSemaphorePermit};
pub(crate) async fn device_ws(State(app):State<App>, headers:HeaderMap, ws:WebSocketUpgrade)->Response { if let Some(origin)=headers.get(ORIGIN).and_then(|h|h.to_str().ok()){if !app.0.allowed_origins.iter().any(|allowed|allowed==origin){return error(StatusCode::FORBIDDEN)}} let Ok(permit)=app.0.preauth.clone().try_acquire_owned() else{return error(StatusCode::SERVICE_UNAVAILABLE)}; ws.max_message_size(MAX_FRAME).on_upgrade(move|socket|device_auth(socket,app,permit)) }
async fn device_auth(mut socket:WebSocket, app:App, _permit:OwnedSemaphorePermit) {
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
                    let clean=if typ=="session.watch" {json!({"v":1,"type":typ,"instanceId":id,"requestId":v["requestId"],"payload":{"sessionId":v["sessionId"],"deviceId":device}})}
                        else {json!({"v":1,"type":typ,"instanceId":id,"requestId":v["requestId"],"payload":{"approvalId":v["approvalId"],"revision":v["revision"],"argsSha256":v["argsSha256"],"decision":v["decision"],"deviceId":device}})};
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
