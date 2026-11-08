FROM rust:1.85-bookworm AS build
WORKDIR /src
COPY Cargo.toml .
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN useradd --system --uid 10001 relay && mkdir -p /var/lib/kalio-relay && chown relay:relay /var/lib/kalio-relay
COPY --from=build /src/target/release/kalio-relay /usr/local/bin/kalio-relay
USER relay
ENV KALIO_RELAY_BIND=0.0.0.0:8787 KALIO_RELAY_DATA=/var/lib/kalio-relay/relay.sqlite
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/kalio-relay"]
