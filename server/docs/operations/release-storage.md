---
title: Release storage — deploy checklist
status: active
updated: 2026-11-10
---

# Release storage: deploy checklist

What production needs before developers upload and publish release files. Background: `docs/architecture.md` §12 and
`docs/releases/release-management.md`.

## 1. Bucket

One **private** bucket (`OCI_BUCKET`) holds everything:

| Prefix | Holds |
|---|---|
| `draft/{randomId}/{name}` | files on unpublished releases |
| `publish/{productId}/{version}/{randomId}/{name}` | published, archived and rolled-back files |

Objects stored before these prefixes keep their `staged/…` and `releases/…`
keys and go on working.

Never make the bucket public: a public bucket serves unfinished builds and
every version to anyone with the URL. Customers get 1-hour object PARs.

**Moving from two buckets:** `OCI_STAGING_BUCKET` and `OCI_RELEASE_BUCKET` are
gone and are ignored if still set. If production used them, copy every object
from both into `OCI_BUCKET`, with the same keys, before deploying this version.
Otherwise existing downloads and drafts stop working.

## 2. Server environment

```
STORAGE_DRIVER=oci                 # production refuses to boot otherwise
OCI_AUTH_MODE=instance-principal
OCI_REGION=…
OCI_OBJECT_NAMESPACE=…
OCI_BUCKET=…
MAX_UPLOAD_BYTES=1073741824        # 1 GiB per file
UPLOAD_PART_BYTES=10485760         # 10 MiB multipart parts (OCI minimum)
UPLOAD_TIMEOUT_MS=7200000          # 2 h per upload request (server-wide)
COPY_TIMEOUT_MS=1800000            # 30 min per publish copy
COPY_POLL_MS=1000
PUBLISH_JOB_TTL_MS=600000
```

## 3. IAM

- **The VM's instance principal (dynamic group):**
  - read, write and delete objects in the bucket (uploads run as multipart:
    create, upload part, commit, abort);
  - manage pre-authenticated requests on the bucket (`PAR_MANAGE`), for
    downloads.
- **The Object Storage service itself**, for publish copies. OCI performs
  `CopyObject` as a work request run by the service, so it needs its own
  policy in the compartment that holds the bucket:

  ```
  Allow service objectstorage-<region> to manage object-family in compartment <compartment>
  ```

  A missing policy makes the publish job fail with `COPY_FAILED`.

## 4. Lifecycle rule

Add an Object Lifecycle Management rule that **aborts uncommitted multipart
uploads after 1 day**. The server aborts uploads itself on errors and
cancels; this only covers a server crash mid-upload, whose parts would
otherwise be kept and billed.

## 5. nginx (in front of the API)

```nginx
location /api/ {
    client_max_body_size 1100m;      # MAX_UPLOAD_BYTES + multipart overhead
    proxy_request_buffering off;     # stream uploads straight to the API
    proxy_read_timeout 7200s;        # match UPLOAD_TIMEOUT_MS
    proxy_send_timeout 7200s;
    proxy_pass http://127.0.0.1:5000;
}
```

Every hop an upload passes through needs the same long limit; any one left at its default cuts uploads off. In dev, that hop is the Vite server: `client/vite.config.ts` raises Vite's own Node `requestTimeout` (default 300 s) along with the proxy timeouts. Without it, any dev upload taking more than 5 minutes was cut off with a 408, even though the API still saved the file.

## 6. Verify on the real bucket

From `server/` on the VM (or a machine with the same credentials):

1. `npm run storage:smoke`: multipart upload, delete, and an aborted upload
   leaves no object.
2. `npm run storage:copy-smoke`: copies 1 GiB (`SMOKE_COPY_MB` to change)
   from `draft/` to `publish/`. It prints the timing and fails with a hint if
   the service policy in §3 is missing.

Measured on the dev bucket (2026-10-23): a 1 GiB copy took 11.8 s, and
`percentComplete` reports 0 until it jumps to 100.
