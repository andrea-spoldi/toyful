FROM node:18.15.0-alpine3.17 as dependencies

WORKDIR /usr/src/app

ADD backend/package.json backend/package-lock.json ./
RUN npm ci

FROM node:18.15.0-alpine3.17 as pruned-dependencies

WORKDIR /usr/src/app
COPY backend/package.json backend/package-lock.json ./
COPY --from=dependencies /usr/src/app/node_modules ./node_modules
RUN npm prune --omit=dev

FROM node:18.15.0-alpine3.17 as builder

WORKDIR /usr/src/app

ADD backend/package.json backend/package-lock.json backend/tsconfig.json ./
COPY --from=dependencies /usr/src/app/node_modules ./node_modules
ADD backend/src ./src

RUN npx tsc -p .

FROM alpine:3.17 as cert

RUN wget -O /rds-global-bundle.crt https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

FROM node:18.15.0-alpine3.17
RUN apk update && apk --no-cache upgrade

COPY --from=cert /rds-global-bundle.crt /usr/local/share/ca-certificates

ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates

WORKDIR /usr/src/app
RUN chown node:node ./
USER node

COPY --from=pruned-dependencies /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist

# Start
CMD ["node", "dist/index.js"]

EXPOSE 3000
