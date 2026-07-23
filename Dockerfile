# -----------------------------------------------------------------------------
# Integration image.
#
# Gladys sandbox constraints ("the sandbox is the defense"):
#   - rootfs mounted READ-ONLY -> never write outside /data
#   - a single writable volume: /data
#   - runs as a non-root user
#   - multi-arch image (linux/amd64 + linux/arm64), see the CI workflow
# -----------------------------------------------------------------------------

FROM node:24-alpine

# dumb-init: handles signals (SIGTERM) correctly for a graceful shutdown.
RUN apk add --no-cache dumb-init

WORKDIR /app

# Install the PROD dependencies first (better build cache).
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
# tuyapi-newgen prints raw debug banners on stdout on every connection
# ("******debug flag is false *****"): strip them from the image so the
# container logs stay readable.
RUN sed -i '/debug flag is false/d;/debug log is NOT enabled/d' \
  node_modules/@demirdeniz/tuyapi-newgen/index.js

# Then the integration code.
COPY index.js ./
COPY src ./src
COPY gladys-assistant-integration.json ./
# User documentation (docs/en.md + docs/fr.md): the core re-hosts it behind the
# "Documentation" link of the Configuration screen.
COPY docs ./docs

# The only writable location allowed at runtime.
ENV NODE_ENV=production
VOLUME ["/data"]

# Run as an unprivileged user (already present in the node image).
USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
