FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --prefix /opt/pnpm pnpm@10.18.1
COPY . .
RUN node /opt/pnpm/node_modules/pnpm/bin/pnpm.cjs install --frozen-lockfile && node /opt/pnpm/node_modules/pnpm/bin/pnpm.cjs build
CMD ["node", "apps/api/dist/main.js"]
