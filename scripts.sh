#!/usr/bin/env bash

# Exit script as soon as a command fails.
set -o errexit

# Exporting variables from the env file and making them available in the code below
set -a
source .env
set +a

TX_FILE=$1

# ADDRESSES
HOME_SAFE_ADDRESS="0x0Ad7de9064BAA98892a244e1415Ca8a2766096D2"
FOREIGN_SAFE_ADDRESS="0xf02796C7B84F10Fa866DAa7d5701A95f3131A727"

HOME_NETWORK="chiado"
HOME_TX_FILE="$1-home.json"
FOREIGN_NETWORK="goerli"
FOREIGN_TX_FILE="$1-foreign.json"

if [ ! -f $HOME_TX_FILE ]; then
  echo "$HOME_TX_FILE for Home TX does not exists"
  exit 1
fi
NETWORK=$HOME_NETWORK
yarn safe execute-custom-proposal $HOME_SAFE_ADDRESS $HOME_TX_FILE

if [ ! -f $FOREIGN_TX_FILE ]; then
  echo "$FOREIGN_TX_FILE for Foreign TX does not exists"
  exit 1
fi
NETWORK=$FOREIGN_NETWORK
yarn safe execute-custom-proposal $FOREIGN_SAFE_ADDRESS $FOREIGN_TX_FILE
