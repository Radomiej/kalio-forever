# syntax=docker/dockerfile:1
FROM ubuntu:24.04 AS install

ARG TARGETARCH
ARG RUNTIME_VERSION
ARG RUNTIME_SHA256
RUN --mount=type=bind,source=release,target=/release,readonly \
    --mount=type=bind,source=scripts/install.sh,target=/tmp/install.sh,readonly \
    test "$TARGETARCH" = amd64 && \
    test -n "$RUNTIME_VERSION" && test -n "$RUNTIME_SHA256" && \
    bash /tmp/install.sh \
      --archive "/release/kalio-runtime-${RUNTIME_VERSION}-linux-x64.tar.gz" \
      --sha256 "$RUNTIME_SHA256" --install-root /opt/kalio \
      --no-launch --no-desktop-icon && \
    rm /opt/kalio/data/.env && \
    mv /opt/kalio/data /data && \
    ln -s /data /opt/kalio/data

FROM ubuntu:24.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates git libatomic1 libstdc++6 && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --gid 10001 kalio && \
    useradd --uid 10001 --gid kalio --create-home kalio

COPY --from=install /opt/kalio /opt/kalio
COPY --from=install --chown=10001:10001 /data /data
# The launcher creates its process lock directly in KALIO_HOME.
RUN chown 10001:10001 /opt/kalio

ENV HOME=/home/kalio \
    KALIO_HOST=0.0.0.0 \
    KALIO_PORT=4016
WORKDIR /opt/kalio
USER 10001:10001
VOLUME ["/data"]
EXPOSE 4016
ENTRYPOINT ["/opt/kalio/bin/kalio"]
CMD ["serve"]
