# Reference artifact: requires an independently configured Supabase project.
# No production credentials or database snapshot are included.
FROM node:24-alpine
WORKDIR /app/tcp-server
COPY tcp-server/package.json tcp-server/package-lock.json ./
RUN npm ci --omit=dev
COPY tcp-server ./
COPY sdk/js /app/sdk/js
COPY protocol /app/protocol
USER node
EXPOSE 8080/tcp 8081/udp
CMD ["node", "server.js"]
