use super::*;
    use crate::{agent::agent_ws, device::device_ws, protocol::*, relay::*, state::*};
    use axum::{routing::{get,post},Router};
    use rusqlite::{Connection,params};
    use serde_json::json;
    use std::{collections::HashMap,sync::{Arc,Mutex},time::Duration};
    use tokio::sync::{RwLock,Semaphore};
    use tower_http::cors::{AllowOrigin,CorsLayer};
    use axum::http::{Method,header::CONTENT_TYPE};
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
