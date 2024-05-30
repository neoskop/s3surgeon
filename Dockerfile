FROM node:20.14.0-buster-slim as base
USER node
RUN mkdir -p /home/node/app
WORKDIR /home/node/app
COPY --chown=node package*.json ./
RUN npm i
COPY --chown=node . ./
ENTRYPOINT [ "npm", "start", "--", "--" ]
