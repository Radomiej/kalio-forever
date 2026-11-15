use crate::{agent::agent_ws, device::device_ws, relay::*, state::*};
use axum::http::{header::CONTENT_TYPE, Method};
use axum::{
    routing::{get, post},
    Router,
};
use futures_util::{SinkExt, StreamExt};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::{RwLock, Semaphore};
use tokio_tungstenite::{connect_async, tungstenite::Message as ClientMessage};
use tower_http::cors::{AllowOrigin, CorsLayer};

async fn test_server() -> (String, tokio::task::JoinHandle<()>, App) {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("CREATE TABLE devices(instance TEXT NOT NULL, device TEXT NOT NULL, token_hash BLOB NOT NULL, PRIMARY KEY(instance,device));").unwrap();
    let app = App(Arc::new(Inner {
        allowed_origins: vec!["https://localhost".into(), "http://localhost".into()],
        preauth: Arc::new(Semaphore::new(32)),
        agents: HashMap::from([("desk".to_string(), hash("agent-secret"))]),
        db: Mutex::new(db),
        instances: RwLock::new(HashMap::new()),
        pairs: Mutex::new(HashMap::new()),
    }));
    let router = Router::new()
        .route("/healthz", get(health))
        .route("/v1/pair", post(pair))
        .route("/v1/agent/{instance}", get(agent_ws))
        .route("/v1/device", get(device_ws))
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(
                    app.0.allowed_origins.iter().map(|o| o.parse().unwrap()),
                ))
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers([CONTENT_TYPE]),
        )
        .with_state(app.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    (format!("ws://{address}"), task, app)
}
async fn auth_agent(
    base: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let (mut ws, _) = connect_async(format!("{base}/v1/agent/desk"))
        .await
        .unwrap();
    ws.send(ClientMessage::Text(json!({"v":1,"type":"agent.authenticate","instanceId":"desk","payload":{"token":"agent-secret"}}).to_string().into())).await.unwrap();
    let frame = tokio::time::timeout(Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(frame.into_text().unwrap().contains("auth.accepted"));
    ws
}
async fn auth_device(
    base: &str,
    token: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let (mut ws, _) = connect_async(format!("{base}/v1/device")).await.unwrap();
    ws.send(ClientMessage::Text(
        json!({"v":1,"type":"auth","instanceId":"desk","token":token})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let frame = tokio::time::timeout(Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(frame.into_text().unwrap().contains("auth.accepted"));
    ws
}
#[tokio::test]
async fn replacing_agent_closes_old_socket_without_offlining_new_agent() {
    let (base, server, app) = test_server().await;
    let mut old = auth_agent(&base).await;
    let mut new = auth_agent(&base).await;
    let ended = tokio::time::timeout(Duration::from_secs(2), old.next())
        .await
        .unwrap();
    assert!(matches!(
        ended,
        None | Some(Err(_)) | Some(Ok(ClientMessage::Close(_)))
    ));
    let state = app.0.instances.read().await;
    let current = state.get("desk").unwrap();
    assert!(!current.offline);
    assert!(current.agent.is_some());
    drop(state);
    new.send(ClientMessage::Close(None)).await.unwrap();
    server.abort();
}
#[tokio::test]
async fn replacing_device_closes_only_the_old_connection() {
    let (base, server, app) = test_server().await;
    app.0
        .db
        .lock()
        .unwrap()
        .execute(
            "INSERT INTO devices(instance,device,token_hash) VALUES(?1,?2,?3)",
            params!["desk", "phone", hash("device-secret").as_slice()],
        )
        .unwrap();
    let mut old = auth_device(&base, "device-secret").await;
    assert_eq!(text_json(&mut old).await["type"], "instance.offline");
    let mut new = auth_device(&base, "device-secret").await;
    let ended = tokio::time::timeout(Duration::from_secs(2), old.next())
        .await
        .unwrap();
    assert!(matches!(
        ended,
        None | Some(Err(_)) | Some(Ok(ClientMessage::Close(_)))
    ));
    let state = app.0.instances.read().await;
    assert!(state.get("desk").unwrap().devices.contains_key("phone"));
    drop(state);
    new.send(ClientMessage::Close(None)).await.unwrap();
    server.abort();
}
#[tokio::test]
async fn cors_allows_configured_origin_and_rejects_other_origins() {
    let (base, server, _) = test_server().await;
    let http = base.replacen("ws://", "http://", 1);
    let client = reqwest::Client::new();
    let allowed = client
        .request(reqwest::Method::OPTIONS, format!("{http}/v1/pair"))
        .header("origin", "https://localhost")
        .header("access-control-request-method", "POST")
        .header("access-control-request-headers", "content-type")
        .send()
        .await
        .unwrap();
    assert_eq!(
        allowed
            .headers()
            .get("access-control-allow-origin")
            .unwrap(),
        "https://localhost"
    );
    assert!(allowed
        .headers()
        .get("access-control-allow-methods")
        .unwrap()
        .to_str()
        .unwrap()
        .contains("POST"));
    let blocked = client
        .request(reqwest::Method::OPTIONS, format!("{http}/v1/pair"))
        .header("origin", "https://attacker.example")
        .header("access-control-request-method", "POST")
        .send()
        .await
        .unwrap();
    assert!(blocked
        .headers()
        .get("access-control-allow-origin")
        .is_none());
    server.abort();
}
async fn text_json<S>(socket: &mut S) -> Value
where
    S: futures_util::Stream<Item = Result<ClientMessage, tokio_tungstenite::tungstenite::Error>>
        + Unpin,
{
    let frame = tokio::time::timeout(Duration::from_secs(2), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    serde_json::from_str(&frame.into_text().unwrap()).unwrap()
}
#[tokio::test]
async fn paired_device_can_watch_and_submit_authenticated_approval_decisions() {
    let (base, server, app) = test_server().await;
    let http = base.replacen("ws://", "http://", 1);
    let client = reqwest::Client::new();
    let mut host = auth_agent(&base).await;
    host.send(ClientMessage::Text(
        json!({"v":1,"type":"pair.create","instanceId":"desk","requestId":"pair-1"})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let created = text_json(&mut host).await;
    assert_eq!(created["type"], "pair.created");
    assert_eq!(created["requestId"], "pair-1");
    let code = created["payload"]["code"].as_str().unwrap();
    let pair = client
        .post(format!("{http}/v1/pair"))
        .json(&json!({"code":code}))
        .send()
        .await
        .unwrap();
    assert!(pair.status().is_success());
    let credentials: Value = pair.json().await.unwrap();
    let replay = client
        .post(format!("{http}/v1/pair"))
        .json(&json!({"code":code}))
        .send()
        .await
        .unwrap();
    assert_eq!(replay.status(), reqwest::StatusCode::UNAUTHORIZED);
    let mut phone = auth_device(&base, credentials["token"].as_str().unwrap()).await;
    app.0
        .db
        .lock()
        .unwrap()
        .execute(
            "INSERT INTO devices(instance,device,token_hash) VALUES(?1,?2,?3)",
            params!["desk", "second-device", hash("second-token").as_slice()],
        )
        .unwrap();
    let mut second_phone = auth_device(&base, "second-token").await;

    host.send(ClientMessage::Text(
        json!({"v":1,"type":"snapshot","instanceId":"desk","payload":{"overview":"ready"}})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let snapshot = text_json(&mut phone).await;
    assert_eq!(snapshot["type"], "snapshot");
    assert_eq!(text_json(&mut second_phone).await["type"], "snapshot");

    phone.send(ClientMessage::Text(json!({"v":1,"type":"session.watch","instanceId":"desk","requestId":"watch-1","sessionId":"session-7","extra":"drop"}).to_string().into())).await.unwrap();
    let watch = text_json(&mut host).await;
    assert_ne!(watch["requestId"], "watch-1");
    assert_eq!(watch["payload"]["sessionId"], "session-7");
    assert_eq!(watch["payload"]["deviceId"], credentials["deviceId"]);
    assert!(watch.get("sessionId").is_none());
    assert!(watch.get("extra").is_none());
    host.send(ClientMessage::Text(json!({"v":1,"type":"session.snapshot","instanceId":"desk","requestId":watch["requestId"],"payload":{"deviceId":credentials["deviceId"],"session":{"id":"session-7"}}}).to_string().into())).await.unwrap();
    assert_eq!(text_json(&mut phone).await["requestId"], "watch-1");

    phone.send(ClientMessage::Text(json!({"v":1,"type":"approval.decide","instanceId":"desk","requestId":"decision-1","approvalId":"approval-2","revision":"rev-3","argsSha256":"digest","decision":"approve","payload":{"deviceId":"spoof"}}).to_string().into())).await.unwrap();
    let decision = text_json(&mut host).await;
    assert_eq!(decision["requestId"], "decision-1");
    assert_eq!(decision["payload"]["approvalId"], "approval-2");
    assert_eq!(decision["payload"]["decision"], "approve");
    assert_eq!(decision["payload"]["deviceId"], credentials["deviceId"]);
    assert!(decision.get("approvalId").is_none());

    host.send(ClientMessage::Text(json!({"v":1,"type":"approval.result","instanceId":"desk","requestId":"decision-1","payload":{"deviceId":credentials["deviceId"],"approvalId":"approval-2","status":"settled"}}).to_string().into())).await.unwrap();
    let result = text_json(&mut phone).await;
    assert_eq!(result["payload"]["status"], "settled");
    assert!(
        tokio::time::timeout(Duration::from_millis(150), second_phone.next())
            .await
            .is_err()
    );
    let mut reconnected_phone = auth_device(&base, credentials["token"].as_str().unwrap()).await;
    assert_eq!(text_json(&mut reconnected_phone).await["type"], "snapshot");
    let replay = tokio::time::timeout(Duration::from_millis(150), async {
        while let Some(frame) = reconnected_phone.next().await {
            let frame = frame.expect("reconnected device socket");
            if let ClientMessage::Text(text) = frame {
                let message: Value = serde_json::from_str(&text).unwrap();
                panic!(
                    "unexpected replay after current snapshot: {}",
                    message["type"]
                );
            }
        }
    })
    .await;
    assert!(replay.is_err());
    phone = reconnected_phone;
    host.send(ClientMessage::Close(None)).await.unwrap();
    assert_eq!(text_json(&mut phone).await["type"], "instance.offline");
    assert_eq!(
        text_json(&mut second_phone).await["type"],
        "instance.offline"
    );
    let mut offline_phone = auth_device(&base, "second-token").await;
    assert_eq!(
        text_json(&mut offline_phone).await["type"],
        "instance.offline"
    );

    send_json(&mut phone, json!({"v":1,"type":"approval.decide","instanceId":"desk","requestId":"offline-1","approvalId":"a","revision":"r","argsSha256":"d","decision":"deny"})).await;
    assert_eq!(
        text_json(&mut phone).await,
        json!({"v":1,"type":"approval.rejected","instanceId":"desk","requestId":"offline-1","reason":"instance_offline"})
    );
    send_json(&mut phone, watch_command("offline-watch", "session-7")).await;
    assert_eq!(
        text_json(&mut phone).await,
        json!({"v":1,"type":"session.snapshot","instanceId":"desk","requestId":"offline-watch","payload":{"session":null,"error":"instance_offline"}})
    );

    let mut reconnect = auth_agent(&base).await;
    send_json(&mut reconnect, json!({"v":1,"type":"snapshot","instanceId":"desk","sequence":1,"payload":{"overview":"fresh"}})).await;
    for device in [&mut phone, &mut offline_phone] {
        assert_eq!(text_json(device).await["type"], "instance.online");
        let fresh = text_json(device).await;
        assert_eq!(fresh["type"], "snapshot");
        assert_eq!(fresh["payload"]["overview"], "fresh");
    }
    let mut hydrated_phone = auth_device(&base, "second-token").await;
    assert_eq!(
        text_json(&mut hydrated_phone).await["payload"]["overview"],
        "fresh"
    );
    server.abort();
}

async fn send_json<S>(socket: &mut S, frame: Value)
where
    S: futures_util::Sink<ClientMessage, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    socket
        .send(ClientMessage::Text(frame.to_string().into()))
        .await
        .unwrap();
}

fn watch_command(request_id: &str, session_id: &str) -> Value {
    json!({"v":1,"type":"session.watch","instanceId":"desk","requestId":request_id,"sessionId":session_id})
}

fn watch_response(watch: &Value, device: &str, projection: Value) -> Value {
    let mut payload = projection;
    payload["deviceId"] = json!(device);
    json!({"v":1,"type":"session.snapshot","instanceId":"desk","requestId":watch["requestId"],"payload":payload})
}

#[tokio::test]
async fn reused_watch_ids_are_scoped_to_the_latest_watch_and_device_socket() {
    let (base, server, app) = test_server().await;
    for device in ["first", "second"] {
        app.0
            .db
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO devices(instance,device,token_hash) VALUES(?1,?2,?3)",
                params!["desk", device, hash(device).as_slice()],
            )
            .unwrap();
    }
    let mut host = auth_agent(&base).await;
    let mut first = auth_device(&base, "first").await;
    let mut second = auth_device(&base, "second").await;

    send_json(&mut first, watch_command("same", "")).await;
    send_json(&mut first, watch_command("same", "old")).await;
    let invalid = text_json(&mut first).await;
    assert_eq!(invalid["requestId"], "same");
    assert_eq!(invalid["payload"]["error"], "invalid_session");
    let old = text_json(&mut host).await;
    send_json(&mut first, watch_command("same", "current")).await;
    let current = text_json(&mut host).await;
    send_json(&mut second, watch_command("same", "second")).await;
    let other = text_json(&mut host).await;
    assert_ne!(old["requestId"], current["requestId"]);
    assert_ne!(current["requestId"], other["requestId"]);

    send_json(
        &mut host,
        watch_response(&old, "first", json!({"session":{"id":"old"}})),
    )
    .await;
    send_json(
        &mut host,
        watch_response(&current, "second", json!({"session":{"id":"current"}})),
    )
    .await;
    send_json(
        &mut host,
        watch_response(
            &current,
            "first",
            json!({"session":null,"error":"projection_failed"}),
        ),
    )
    .await;
    send_json(
        &mut host,
        watch_response(&other, "second", json!({"session":{"id":"second"}})),
    )
    .await;
    let failed = text_json(&mut first).await;
    assert_eq!(failed["requestId"], "same");
    assert_eq!(failed["payload"]["error"], "projection_failed");
    let isolated = text_json(&mut second).await;
    assert_eq!(isolated["requestId"], "same");
    assert_eq!(isolated["payload"]["session"]["id"], "second");

    let mut replacement = auth_device(&base, "first").await;
    let unwatch = text_json(&mut host).await;
    assert_eq!(unwatch["type"], "session.unwatch");
    assert_eq!(unwatch["payload"]["deviceId"], "first");
    send_json(&mut replacement, watch_command("same", "current")).await;
    let new = text_json(&mut host).await;
    assert_ne!(current["requestId"], new["requestId"]);
    send_json(
        &mut host,
        watch_response(&current, "first", json!({"session":{"id":"stale-socket"}})),
    )
    .await;
    send_json(
        &mut host,
        watch_response(&new, "first", json!({"session":{"id":"current"}})),
    )
    .await;
    let fresh = text_json(&mut replacement).await;
    assert_eq!(fresh["requestId"], "same");
    assert_eq!(fresh["payload"]["session"]["id"], "current");
    send_json(&mut second, json!({"v":1,"type":"session.unwatch","instanceId":"desk","deviceId":"first","payload":{"deviceId":"first"}})).await;
    let unwatch = text_json(&mut host).await;
    assert_eq!(unwatch["type"], "session.unwatch");
    assert_eq!(unwatch["payload"]["deviceId"], "second");

    send_json(
        &mut host,
        watch_response(&other, "second", json!({"session":{"id":"unwatched"}})),
    )
    .await;
    send_json(
        &mut host,
        watch_response(&new, "first", json!({"session":{"id":"still-current"}})),
    )
    .await;
    assert_eq!(
        text_json(&mut replacement).await["payload"]["session"]["id"],
        "still-current"
    );
    send_json(
        &mut host,
        json!({"v":1,"type":"snapshot","instanceId":"desk","payload":{"overview":"barrier"}}),
    )
    .await;
    assert_eq!(text_json(&mut second).await["type"], "snapshot");
    server.abort();
}

#[test]
fn failed_unwatch_cancels_the_host_to_reclaim_watch_slots() {
    let (agent, mut queue) = tokio::sync::mpsc::channel(1);
    let (cancel, cancelled) = tokio::sync::watch::channel(false);
    agent.try_send("already queued".to_owned()).unwrap();
    let mut instance = Instance {
        agent: Some(agent),
        agent_cancel: Some(cancel),
        ..Instance::default()
    };
    instance.watches.insert(
        "device".into(),
        SessionWatch {
            client_id: "client".into(),
            host_id: "host".into(),
        },
    );
    instance.clear_watch("desk", "device");
    assert!(instance.watches.is_empty());
    assert!(*cancelled.borrow());
    assert!(queue.try_recv().is_ok());
    assert_eq!(instance.forward("new command".into()), Err("relay_busy"));
}
