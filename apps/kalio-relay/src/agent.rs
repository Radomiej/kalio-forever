use crate::{
    protocol::*,
    relay::{error, hash, now, random_hex, send_socket, MAX_FRAME, PAIR_LIMIT, QUEUE},
    state::*,
};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::StatusCode,
    response::Response,
};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, watch, OwnedSemaphorePermit};
pub(crate) async fn agent_ws(
    Path(id): Path<String>,
    State(app): State<App>,
    ws: WebSocketUpgrade,
) -> Response {
    let Ok(permit) = app.0.preauth.clone().try_acquire_owned() else {
        return error(StatusCode::SERVICE_UNAVAILABLE);
    };
    ws.max_message_size(MAX_FRAME)
        .on_upgrade(move |socket| agent_auth(socket, app, id, permit))
}
async fn agent_auth(mut socket: WebSocket, app: App, id: String, _permit: OwnedSemaphorePermit) {
    let first = tokio::time::timeout(Duration::from_secs(5), socket.recv()).await;
    let Ok(Some(Ok(Message::Text(text)))) = first else {
        return;
    };
    if text.len() > MAX_FRAME {
        return;
    }
    let Ok(e) = serde_json::from_str::<Envelope>(&text) else {
        return;
    };
    let Some(token) = e
        .payload
        .as_ref()
        .and_then(|p| p.get("token"))
        .and_then(Value::as_str)
    else {
        return;
    };
    let Some(expected) = app.0.agents.get(&id) else {
        return;
    };
    if e.v != 1
        || e.kind != "agent.authenticate"
        || e.instance_id != id
        || !bool::from(subtle::ConstantTimeEq::ct_eq(
            hash(token).as_slice(),
            expected.as_slice(),
        ))
    {
        return;
    }
    agent_loop(socket, app, id).await
}
async fn agent_loop(mut socket: WebSocket, app: App, id: String) {
    let (tx, mut rx) = mpsc::channel::<String>(QUEUE);
    let (cancel_tx, mut cancel_rx) = watch::channel(false);
    let generation = {
        let mut all = app.0.instances.write().await;
        let i = all.entry(id.clone()).or_default();
        if let Some(old) = i.agent_cancel.take() {
            let _ = old.send(true);
        }
        i.agent_generation += 1;
        i.agent_cancel = Some(cancel_tx);
        i.agent = Some(tx.clone());
        i.offline = false;
        i.snapshot = None;
        i.watches.clear();
        i.broadcast(
            &id,
            json!({"v":1,"type":"instance.online","instanceId":id}).to_string(),
        );
        i.agent_generation
    };
    let authenticated = send_socket(
        &mut socket,
        Message::Text(
            json!({"v":1,"type":"auth.accepted","instanceId":id})
                .to_string()
                .into(),
        ),
    )
    .await;
    if authenticated {
        loop {
            tokio::select! {
                biased;
                _=cancel_rx.changed()=>{let _=send_socket(&mut socket,Message::Close(None)).await;break},
                out=rx.recv()=> match out {Some(out)=>if !send_socket(&mut socket,Message::Text(out.into())).await{break},None=>break},
                incoming=socket.recv()=> match incoming {
                    Some(Ok(Message::Text(text))) if text.len()<=MAX_FRAME => {
                        let Ok(e)=serde_json::from_str::<Envelope>(&text) else {continue};
                        if e.v!=1 || e.instance_id!=id {continue}
                        if !matches!(e.kind.as_str(),"snapshot"|"session.snapshot"|"approval.result"|"pair.create") {continue}
                        if e.kind=="pair.create" {
                            let all=app.0.instances.read().await;
                            if all.get(&id).is_none_or(|i|i.agent_generation!=generation){break}

                            let mut pairs=app.0.pairs.lock().unwrap(); pairs.retain(|_,p|p.expires>Instant::now());
                            if pairs.len()>=PAIR_LIMIT {continue}
                            let code=random_hex(16); pairs.insert(code.clone(),Pair{instance:id.clone(),expires:Instant::now()+Duration::from_secs(120)});
                            let created=Envelope{v:1,kind:"pair.created".into(),instance_id:id.clone(),sequence:None,request_id:e.request_id,payload:Some(json!({"code":code,"expiresAt":now()+120}))};
                            if let Ok(s)=serde_json::to_string(&created){if tx.try_send(s).is_err(){break}}
                            continue
                        }
                        let mut all=app.0.instances.write().await;
                        let Some(i)=all.get_mut(&id).filter(|i| i.agent_generation==generation) else {break};
                        if e.kind=="snapshot" {
                            if let Ok(frame)=serde_json::to_string(&e) {
                                i.snapshot=Some(frame.clone());
                                i.broadcast(&id,frame);
                            }
                        } else if let Some(device)=e.payload.as_ref().and_then(|p|p.get("deviceId")).and_then(Value::as_str).map(str::to_owned) {
                            if e.kind=="session.snapshot" {
                                if i.watches.get(&device).is_some_and(|watch| e.request_id.as_ref()==Some(&watch.host_id)) {
                                    i.enqueue(&id,&device,DeviceFrame::Watch(e));
                                }
                            } else if let Ok(frame)=serde_json::to_string(&e) {
                                i.enqueue(&id,&device,DeviceFrame::General(frame));
                            }
                        }
                    },
                    Some(Ok(Message::Close(_)))|None=>break,
                    Some(Err(_))=>break,
                    _=>{}
                }
            }
        }
    }
    let mut all = app.0.instances.write().await;
    if let Some(i) = all
        .get_mut(&id)
        .filter(|i| i.agent_generation == generation)
    {
        i.agent = None;
        i.agent_cancel = None;
        i.offline = true;
        i.snapshot = None;
        i.watches.clear();
        i.broadcast(
            &id,
            json!({"v":1,"type":"instance.offline","instanceId":id}).to_string(),
        );
    }
}
