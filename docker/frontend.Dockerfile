FROM nginx:alpine
COPY frontend/index.html /usr/share/nginx/html
EXPOSE 80

