use crate::{
    protocol::*,
    relay::{error, hash, random_hex, send_socket, MAX_FRAME, QUEUE},
    state::*,
};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::{header::ORIGIN, HeaderMap, StatusCode},
    response::Response,
};
use rusqlite::params;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::{mpsc, watch, OwnedSemaphorePermit};
pub(crate) async fn device_ws(
    State(app): State<App>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if let Some(origin) = headers.get(ORIGIN).and_then(|h| h.to_str().ok()) {
        if !app
            .0
            .allowed_origins
            .iter()
            .any(|allowed| allowed == origin)
        {
            return error(StatusCode::FORBIDDEN);
        }
    }
    let Ok(permit) = app.0.preauth.clone().try_acquire_owned() else {
        return error(StatusCode::SERVICE_UNAVAILABLE);
    };
    ws.max_message_size(MAX_FRAME)
        .on_upgrade(move |socket| device_auth(socket, app, permit))
}
async fn device_auth(mut socket: WebSocket, app: App, _permit: OwnedSemaphorePermit) {
    let first = tokio::time::timeout(Duration::from_secs(5), socket.recv()).await;
    let Ok(Some(Ok(Message::Text(text)))) = first else {
        return;
    };
    let Ok(auth) = serde_json::from_str::<First>(&text) else {
        return;
    };
    if auth.v != 1 || auth.kind != "auth" || auth.instance_id.is_empty() {
        return;
    }
    let h = hash(&auth.token);
    let device_id = {
        let db = app.0.db.lock().unwrap();
        db.query_row(
            "SELECT device FROM devices WHERE instance=?1 AND token_hash=?2",
            params![auth.instance_id, h.as_slice()],
            |r| r.get::<_, String>(0),
        )
        .ok()
    };
    let Some(device_id) = device_id else { return };
    if !send_socket(
        &mut socket,
        Message::Text(
            json!({"v":1,"type":"auth.accepted","instanceId":auth.instance_id})
                .to_string()
                .into(),
        ),
    )
    .await
    {
        return;
    }
    device_loop(socket, app, auth.instance_id, device_id).await
}
async fn device_loop(mut socket: WebSocket, app: App, id: String, device: String) {
    let (tx, mut rx) = mpsc::channel::<DeviceFrame>(QUEUE);
    let (cancel_tx, mut cancel_rx) = watch::channel(false);
    let (generation, initial) = {
        let mut all = app.0.instances.write().await;
        let i = all.entry(id.clone()).or_insert_with(|| Instance {
            offline: true,
            ..Instance::default()
        });
        if let Some(old) = i.device_cancel.remove(&device) {
            let _ = old.send(true);
        }
        i.clear_watch(&id, &device);
        let gen = i.device_generation.get(&device).copied().unwrap_or(0) + 1;
        i.device_generation.insert(device.clone(), gen);
        i.device_cancel.insert(device.clone(), cancel_tx);
        i.devices.insert(device.clone(), tx);
        let initial = if i.offline {
            Some(json!({"v":1,"type":"instance.offline","instanceId":id}).to_string())
        } else {
            i.snapshot.clone()
        };
        (gen, initial)
    };
    let ready = match initial {
        Some(frame) => send_socket(&mut socket, Message::Text(frame.into())).await,
        None => true,
    };
    let mut watch_generation = 0;
    if ready {
        loop {
            tokio::select! {
                biased;
                _=cancel_rx.changed()=>{let _=socket.send(Message::Close(None)).await;break},
                out=rx.recv()=> {
                    let Some(out)=out else {break};
                    let frame=match out {
                        DeviceFrame::General(frame)=>frame,
                        DeviceFrame::WatchError{generation: failed_generation,frame}=>{
                            if failed_generation!=watch_generation {continue}
                            let all=app.0.instances.read().await;
                            if all.get(&id).is_none_or(|i| i.device_generation.get(&device)!=Some(&generation)) {continue}
                            frame
                        },
                        DeviceFrame::Watch(mut response)=>{
                            let all=app.0.instances.read().await;
                            let Some(watch)=all.get(&id)
                                .filter(|i| i.device_generation.get(&device)==Some(&generation))
                                .and_then(|i| i.watches.get(&device))
                                .filter(|watch| response.request_id.as_ref()==Some(&watch.host_id)) else {continue};
                            response.request_id=Some(watch.client_id.clone());
                            let Ok(frame)=serde_json::to_string(&response) else {continue};
                            frame
                        }
                    };
                    if !send_socket(&mut socket,Message::Text(frame.into())).await {break}
                },
                incoming=socket.recv()=> match incoming {
                    Some(Ok(Message::Text(text))) if text.len()<=MAX_FRAME=>{
                        let Ok(v)=serde_json::from_str::<Value>(&text) else {continue};
                        let typ=v.get("type").and_then(Value::as_str).unwrap_or("");
                        if v.get("v")!=Some(&json!(1)) || v.get("instanceId").and_then(Value::as_str)!=Some(&id) {continue}
                        if typ=="ping" {let _=socket.send(Message::Text(json!({"v":1,"type":"pong","instanceId":id}).to_string().into())).await;continue}
                        let mut all=app.0.instances.write().await;
                        let Some(i)=all.get_mut(&id).filter(|i| i.device_generation.get(&device)==Some(&generation) && i.devices.contains_key(&device)) else {break};
                        if typ=="session.unwatch" {
                            watch_generation += 1;
                            i.clear_watch(&id,&device);
                            continue
                        }
                        let Some(request_id)=v.get("requestId").and_then(Value::as_str).filter(|id| !id.is_empty()) else {continue};
                        if typ=="session.watch" {watch_generation += 1;}
                        if let Some(failure)=forward_command(i,&id,&device,typ,request_id,&v) {
                            let frame=failure.to_string();
                            let outbound=if typ=="session.watch" {
                                DeviceFrame::WatchError{generation:watch_generation,frame}
                            } else {
                                DeviceFrame::General(frame)
                            };
                            i.enqueue(&id,&device,outbound);
                        }
                    },
                    Some(Ok(Message::Close(_)))|None=>break,
                    Some(Err(_))=>break,
                    _=>{}
                }
            }
        }
    }
    if let Some(i) = app.0.instances.write().await.get_mut(&id) {
        if i.device_generation.get(&device) == Some(&generation) {
            i.clear_watch(&id, &device);
            i.devices.remove(&device);
            i.device_cancel.remove(&device);
        }
    }
}

fn forward_command(
    instance: &mut Instance,
    id: &str,
    device: &str,
    kind: &str,
    request_id: &str,
    frame: &Value,
) -> Option<Value> {
    match kind {
        "session.watch" => {
            let reason = if let Some(session_id) =
                frame["sessionId"].as_str().filter(|id| !id.is_empty())
            {
                let host_id = random_hex(16);
                let command = json!({"v":1,"type":kind,"instanceId":id,"requestId":host_id,"payload":{"sessionId":session_id,"deviceId":device}});
                match instance.forward(command.to_string()) {
                    Ok(()) => {
                        instance.watches.insert(
                            device.to_owned(),
                            SessionWatch {
                                client_id: request_id.to_owned(),
                                host_id,
                            },
                        );
                        return None;
                    }
                    Err(reason) => reason,
                }
            } else {
                "invalid_session"
            };
            instance.clear_watch(id, device);
            Some(
                json!({"v":1,"type":"session.snapshot","instanceId":id,"requestId":request_id,"payload":{"session":null,"error":reason}}),
            )
        }
        "approval.decide" => {
            if !matches!(frame["decision"].as_str(), Some("approve" | "deny"))
                || ["approvalId", "revision", "argsSha256"]
                    .iter()
                    .any(|key| !frame[key].is_string())
            {
                return None;
            }
            let command = json!({"v":1,"type":kind,"instanceId":id,"requestId":request_id,"payload":{"approvalId":frame["approvalId"],"revision":frame["revision"],"argsSha256":frame["argsSha256"],"decision":frame["decision"],"deviceId":device}});
            let reason = instance.forward(command.to_string()).err()?;
            Some(
                json!({"v":1,"type":"approval.rejected","instanceId":id,"requestId":request_id,"reason":reason}),
            )
        }
        _ => None,
    }
}
