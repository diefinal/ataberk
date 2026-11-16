DROP TABLE time_capsules,submissions,media_people;
ALTER TABLE families DROP COLUMN featured_album_id;
ALTER TABLE media DROP COLUMN taken_on,DROP COLUMN place_text,DROP COLUMN poster_media_id;
ALTER TABLE users DROP COLUMN avatar_key,DROP COLUMN theme;
