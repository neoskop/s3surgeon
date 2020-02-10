#!/usr/bin/env bash

set -e

function check_commands() {
    for command in $@; do
        if ! command -v $command >/dev/null; then
            echo -e "Install \033[1m$command\033[0m"
            exit 1
        fi
    done
}

check_commands git yarn npm jq

if [[ "$#" != "1" ]] || [[ ! "$1" =~ ^(patch|minor|major)$ ]]; then
    echo -e "Usage: $0 \033[1mpatch|minor|major\033[0m"
    exit 1
fi

if [[ $(git status --porcelain) ]]; then
    echo -e "The repository has changes. Commit first...\033[0;31mAborting!\033[0m"
    exit 1
fi

git pull --rebase
yarn
npm version --no-git-tag-version $1
version=$(cat package.json | jq -r .version)
sed -i "s/\.version('.*',/.version('$version',/" src/index.ts
yarn build
npm publish
git add .
git commit -m "chore: Bump version to ${version}."
git tag ${version}
git push origin $version
git pull --rebase
git push
