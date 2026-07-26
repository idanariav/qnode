#!/usr/bin/env bash
set -euo pipefail

qnode index && qnode metrics compute
