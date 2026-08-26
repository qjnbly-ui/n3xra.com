FROM node:24-bookworm-slim AS builder

WORKDIR /build
RUN npm install --no-save typescript@5.9.3 @types/node@24.10.0
COPY tsconfig.build-worker.json ./
COPY services/build-worker/src ./services/build-worker/src
RUN ./node_modules/.bin/tsc -p tsconfig.build-worker.json

FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @openai/codex@0.143.0

WORKDIR /app
COPY --from=builder /build/dist/build-worker ./

ENV NODE_ENV=production
ENV PORT=4317
ENV N3XRA_BUILD_HOST=0.0.0.0
EXPOSE 4317

CMD ["node", "server.js"]
