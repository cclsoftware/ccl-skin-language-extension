#!/usr/bin/env bash

cd "$(dirname "$0")"/../
mkdir -p ./build
mkdir -p ./dist
rm -rf ./build/*
rm -rf ./dist/*
cp .vscodeignore dist/.vscodeignore
cp readme.md dist/README.md
cp license.txt dist/LICENSE.txt
cp icon.png dist/icon.png
node scripts/preparepackagejson.mjs
npm install
npm run vscode:prepublish
cd dist/
vsce package --out "../build"
cd ../build
mv *.vsix CCLSkinLanguageSupport.vsix

npm run ci-build
