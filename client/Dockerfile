FROM node:22-alpine AS builder
WORKDIR /app
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=$VITE_BASE_PATH

COPY client/package*.json ./client/
COPY docs-site/package*.json ./docs-site/
RUN npm --prefix ./client ci
RUN npm --prefix ./docs-site ci

COPY client ./client
COPY docs-site ./docs-site
RUN npm --prefix ./client run build

FROM nginx:1.27-alpine AS runner
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/client/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
