FROM node:19.8.1-buster-slim as base
USER node
RUN mkdir -p /home/node/app
WORKDIR /home/node/app
COPY --chown=node package*.json ./
RUN npm i
COPY --chown=node . ./
ENTRYPOINT [ "npm", "start", "--", "--" ]
