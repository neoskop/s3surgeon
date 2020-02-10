FROM node:12.15.0-buster-slim as base
USER node
RUN mkdir -p /home/node/app
WORKDIR /home/node/app
COPY --chown=node package.json yarn.lock ./
RUN yarn
COPY --chown=node . ./
ENTRYPOINT [ "yarn", "start", "--", "--" ]