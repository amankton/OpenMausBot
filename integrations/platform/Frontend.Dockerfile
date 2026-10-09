# Retained Platform runtime: EPL-2.0, https://github.com/Platform-Collective/platform
# Source-built UI: s0.7.426 / 03b7aad7dc562f4f9769c51a4df08191a0393997 + reviewed Chief patches.
# The source server bundle is unchanged; preserve the pinned runtime and Linux native dependencies.
FROM platformcollective/front@sha256:03c16b1ab7ab590f988d781cea345bb2ba06b7f792b819cdb0dd0b39bf14bebe
LABEL org.opencontainers.image.title="Chief Platform frontend" \
      org.opencontainers.image.source="https://github.com/Platform-Collective/platform" \
      org.opencontainers.image.revision="03b7aad7dc562f4f9769c51a4df08191a0393997" \
      org.opencontainers.image.licenses="EPL-2.0"
COPY dist/ /app/dist/
COPY source-notice/ /usr/share/doc/chief-platform-source/
