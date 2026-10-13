# syntax=docker/dockerfile:1

# ---- build stage: compile the TypeScript server -------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime stage: JRE 21 (bundled with Archi) + Node + headless X -----
FROM node:22-bookworm-slim AS runtime
ARG DEBIAN_FRONTEND=noninteractive
# Match the container user to the host uid that owns the mounted volumes:
#   docker build --build-arg ARCHI_UID=$(id -u) -t archi-server .
ARG ARCHI_UID=1001

# SWT/GTK libraries required by Archi even in headless mode, plus Xvfb.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates tini xvfb x11-utils unzip xz-utils fonts-dejavu-core git \
      libgtk-3-0 libglib2.0-0 libx11-6 libxext6 libxi6 libxtst6 libxrender1 libxrandr2 \
      libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxcb1 libxau6 libxdmcp6 \
      libpango-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 libatk1.0-0 libatk-bridge2.0-0 \
      libnss3 libnspr4 libasound2 libcups2 libdrm2 libgbm1 \
 && rm -rf /var/lib/apt/lists/*

ENV HOME=/home/archi \
    ARCHI_HOME=/opt/archi \
    ARCHI_SCRIPTS_DIR=/scripts \
    ARCHI_MODELS_DIR=/models \
    ARCHI_RUNS_DIR=/var/archi/runs \
    ARCHI_GIT_ASKPASS=/usr/local/bin/git-askpass.sh \
    DISPLAY=:99 \
    NODE_ENV=production \
    PORT=3000

RUN useradd --create-home --uid "${ARCHI_UID}" archi

# Archi runtime: launcher, core plugins, and its bundled Temurin JRE 21.
# Populated by scripts/fetch-archi.sh (see README).
COPY vendor/archi/ /opt/archi/
COPY vendor/plugins/ /tmp/plugins/
COPY scripts/install-plugins.sh /usr/local/bin/install-plugins.sh
COPY scripts/git-askpass.sh /usr/local/bin/git-askpass.sh

RUN test -x /opt/archi/Archi \
      || { echo "ERROR: Archi not found in vendor/archi. Run scripts/fetch-archi.sh first."; exit 1; } \
 && chmod +x /usr/local/bin/install-plugins.sh /usr/local/bin/git-askpass.sh \
 && install-plugins.sh /tmp/plugins /home/archi/.archi/dropins \
 && rm -rf /tmp/plugins \
 && chown archi:archi /opt/archi/Archi.ini \
  # Archi.ini uses -cleanConfig, so the launcher rewrites /opt/archi/configuration
  # on every start; keep that directory writable for the runtime user.
 && mkdir -p /opt/archi/configuration \
 && chown -R archi:archi /opt/archi/configuration /opt/archi/p2 \
 && chown archi:archi /opt/archi

RUN mkdir -p /scripts /models /var/archi/runs /home/archi/Documents/Archi \
 && chown -R archi:archi /home/archi /var/archi /scripts /models

WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER archi
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
