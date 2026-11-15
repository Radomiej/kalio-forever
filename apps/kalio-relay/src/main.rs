mod agent;
mod device;
mod protocol;
mod relay;
mod state;
#[cfg(test)]
mod tests;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    relay::run().await
}
