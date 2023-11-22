#!/usr/bin/sh

set -e

BUILD_DIR="builds"

FILES="node_modules dist/index.js package.json"

mkdir -p $BUILD_DIR

echo "build app"

rm -rf dist

npx tsc

echo "moving node_modules"

mv node_modules node_modules_bck

echo "install production packages"

npm ci --prod

ZIPFILENAME=image-compress-$(date -u +%Y%m%d_%H%M%S).zip

zip -r $BUILD_DIR/$ZIPFILENAME $FILES

echo "Cleanup"

rm -rf node_modules

mv node_modules_bck node_modules

echo "Done"