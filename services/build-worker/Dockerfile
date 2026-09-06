FROM node:24-bookworm-slim AS builder

WORKDIR /build
RUN npm install --no-save typescript@5.9.3 @types/node@24.10.0 @vercel/sandbox@3.2.1
COPY tsconfig.build-worker.json ./
COPY services/build-worker/src ./services/build-worker/src
RUN ./node_modules/.bin/tsc -p tsconfig.build-worker.json

FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git bubblewrap tini \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @openai/codex@0.153.4

WORKDIR /app
RUN npm install --no-save --omit=dev @vercel/sandbox@3.2.1
COPY --from=builder /build/dist/build-worker ./

ENV NODE_ENV=production
ENV PORT=4317
ENV N3XRA_BUILD_HOST=0.0.0.0
EXPOSE 4317

# Reap orphaned dev-server children so Astro cannot mistake a zombie PID for a
# running server after preview restart or idle shutdown.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
