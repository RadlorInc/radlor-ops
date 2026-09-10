-- The private bucket for source material. Its own bucket, not `review-videos`.
--
-- ⚠️ THE OTHER BUCKET'S NAME WOULD BECOME A LIE. `review-videos` says what is in it, and a PDF or a
-- font file or a zip sitting inside it makes the name something a later reader has to distrust —
-- the same shape as a `$schema` declaring a draft it is not. A prefix inside the existing bucket
-- would have worked and cost nothing today; it costs the next person a paragraph of explanation
-- every time they list the bucket.
--
-- Private, like the other one. No policies are created: nothing but the service role can reach an
-- object, and the only route to a byte is a short-lived signed URL minted by /api/admin/material.
--
-- ⚠️ THIS FILE IS SKIPPED BY THE OFFLINE HARNESS — PGlite has no object-store schema — so nothing
-- in it is covered by `npm run test:e2e` at any effort. It is verified by the upload working
-- against the live project, and by scripts/check-grants.mjs for the table beside it.
insert into storage.buckets (id, name, public)
values ('review-material', 'review-material', false)
on conflict (id) do nothing;
