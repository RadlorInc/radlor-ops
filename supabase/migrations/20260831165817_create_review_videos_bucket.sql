-- Private bucket for the review tool. Its own name: this project belongs to the marketing site
-- too, and a generic `videos` is how two tools end up writing into one.
--
-- No storage policies are created. Nothing but the service role can reach an object, and the only
-- route to a byte of video is a short-lived signed URL minted by /api/video-url.
insert into storage.buckets (id, name, public)
values ('review-videos', 'review-videos', false)
on conflict (id) do nothing;
