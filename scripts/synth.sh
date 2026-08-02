#!/usr/bin/env bash
# synth.sh — run cdk synth with the required account/region env vars.
# Used by CI and harness verification where AWS env vars aren't pre-set.
set -euo pipefail
export CDK_DEFAULT_ACCOUNT="${CDK_DEFAULT_ACCOUNT:-580956784928}"
export CDK_DEFAULT_REGION="${CDK_DEFAULT_REGION:-us-east-1}"
exec npm run synth
