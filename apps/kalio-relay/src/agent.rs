use crate::{protocol::*, state::*, relay::{broadcast,broadcast_devices,error,hash,now,random_hex,send_socket,MAX_FRAME,QUEUE,HISTORY,PAIR_LIMIT}};
use axum::{extract::{Path, State, ws::{Message, WebSocket, WebSocketUpgrade}}, http::StatusCode, response::{IntoResponse, Response}};
use rusqlite::{params};
use serde_json::{json, Value};
use std::{time::{Duration, Instant}};
use tokio::sync::{mpsc, watch};
pub(crate) async fn agent_ws(Path(id):Path<String>, State(app):State<App>, ws:WebSocketUpgrade) -> Response {
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
