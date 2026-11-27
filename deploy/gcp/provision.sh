#!/usr/bin/env bash
# Dedicated resources only; never changes the project's existing applications.
set -euo pipefail
project=magiclight-2025
region=${GCP_REGION:-asia-southeast1}
zone=${GCP_ZONE:-${region}-b}
name=guangmo-growth
bucket=${project}-guangmo-backups
account=guangmo-growth-runtime
runtime_sa=${account}@${project}.iam.gserviceaccount.com

# Only a confirmed NOT_FOUND permits creation. Network errors must never be
# mistaken for a missing resource during a subsequent deployment.
resource_exists() {
  local response attempt
  for attempt in 1 2 3; do
    if response=$(gcloud "$@" 2>&1); then
      return 0
    fi
    case "$response" in
      *"was not found"*|*"does not exist"*|*"NOT_FOUND"*|*"Unknown service account"*|*"not found"*) return 1 ;;
    esac
    echo "Resource lookup failed; retry $attempt/3" >&2
  done
  echo "$response" >&2
  exit 1
}

# Names are reserved for this application. Existing named resources are inspected
# rather than updated, so repeated invocation is safe.
if ! resource_exists compute networks describe "$name" --project="$project"; then
  gcloud compute networks create "$name" --project="$project" --subnet-mode=custom --quiet
fi
if ! resource_exists compute networks subnets describe "$name" --region="$region" --project="$project"; then
  gcloud compute networks subnets create "$name" --project="$project" --region="$region" --network="$name" --range=10.84.0.0/24 --quiet
fi
if ! resource_exists compute firewall-rules describe "$name-web" --project="$project"; then
  gcloud compute firewall-rules create "$name-web" --project="$project" --network="$name" --allow=tcp:80,tcp:443 --source-ranges=0.0.0.0/0 --target-tags="$name" --quiet
fi
if ! resource_exists compute firewall-rules describe "$name-iap" --project="$project"; then
  gcloud compute firewall-rules create "$name-iap" --project="$project" --network="$name" --allow=tcp:22 --source-ranges=35.235.240.0/20 --target-tags="$name" --quiet
fi
if ! resource_exists iam service-accounts describe "$runtime_sa" --project="$project"; then
  gcloud iam service-accounts create "$account" --project="$project" --display-name='Guangmo container pull and backup only' --quiet
fi
gcloud artifacts repositories add-iam-policy-binding "$name" --project="$project" --location="$region" --member="serviceAccount:$runtime_sa" --role=roles/artifactregistry.reader --quiet >/dev/null
if ! resource_exists storage buckets describe "gs://$bucket" --project="$project"; then
  gcloud storage buckets create "gs://$bucket" --project="$project" --location="$region" --uniform-bucket-level-access --public-access-prevention --quiet
fi
lifecycle=$(mktemp)
trap 'rm -f "$lifecycle"' EXIT
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' > "$lifecycle"
gcloud storage buckets update "gs://$bucket" --project="$project" --lifecycle-file="$lifecycle" --quiet
gcloud storage buckets add-iam-policy-binding "gs://$bucket" --project="$project" --member="serviceAccount:$runtime_sa" --role=roles/storage.objectCreator --quiet >/dev/null
if ! resource_exists compute addresses describe "$name" --project="$project" --region="$region"; then
  gcloud compute addresses create "$name" --project="$project" --region="$region" --network-tier=STANDARD --quiet
fi
address=$(gcloud compute addresses describe "$name" --project="$project" --region="$region" --format='value(address)')
if ! resource_exists compute resource-policies describe "$name-daily" --project="$project" --region="$region"; then
  gcloud compute resource-policies create snapshot-schedule "$name-daily" --project="$project" --region="$region" --daily-schedule --start-time=19:00 --max-retention-days=7 --on-source-disk-delete=keep-auto-snapshots --storage-location="$region" --quiet
fi
if ! resource_exists compute disks describe "$name-data" --project="$project" --zone="$zone"; then
  gcloud compute disks create "$name-data" --project="$project" --zone="$zone" --type=pd-balanced --size=50GB --labels=application=guangmo-growth --quiet
  gcloud compute disks add-resource-policies "$name-data" --project="$project" --zone="$zone" --resource-policies="$name-daily" --quiet
fi
if ! resource_exists compute instances describe "$name" --project="$project" --zone="$zone"; then
  gcloud compute instances create "$name" --project="$project" --zone="$zone" \
    --machine-type=e2-medium --provisioning-model=STANDARD \
    --image-family=debian-12 --image-project=debian-cloud \
    --boot-disk-size=15GB --boot-disk-type=pd-balanced \
    --disk=name="$name-data",device-name=guangmo-data,mode=rw,boot=no,auto-delete=no \
    --network="$name" --subnet="$name" --address="$address" --network-tier=STANDARD \
    --tags="$name" --labels=application=guangmo-growth \
    --service-account="$runtime_sa" --scopes=cloud-platform \
    --metadata=enable-oslogin=TRUE,block-project-ssh-keys=TRUE \
    --metadata-from-file=startup-script=deploy/gcp/bootstrap.sh \
    --shielded-secure-boot --quiet
fi
echo "VM: $name; zone: $zone; address: $address; backup: gs://$bucket"
