version: "3.9"

services:
  mongo:
    image: mongo:7
    container_name: barreldrop-mongo
    restart: unless-stopped
    volumes:
      - /data/mongo:/data/db

  api:
    image: ${api_image}
    container_name: barreldrop-api
    restart: unless-stopped
    env_file:
      - /etc/barreldrop/api.env
    ports:
      - "4000:4000"
    depends_on:
      - mongo

  frontend:
    image: ${frontend_image}
    container_name: barreldrop-frontend
    restart: unless-stopped
    env_file:
      - /etc/barreldrop/frontend.env
    ports:
      - "80:80"
    depends_on:
      - api
