ALTER TABLE albums ADD COLUMN cover_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE memories ADD COLUMN kind TEXT NOT NULL DEFAULT 'story' CHECK(kind IN ('story','first'));
CREATE TABLE favorites(user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,media_id INTEGER REFERENCES media(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(user_id,media_id));
CREATE TABLE family_notes(id SERIAL PRIMARY KEY,album_id INTEGER NOT NULL REFERENCES albums(id),user_id INTEGER NOT NULL REFERENCES users(id),content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 1000),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),deleted_at TIMESTAMPTZ);
CREATE INDEX family_notes_album_idx ON family_notes(album_id) WHERE deleted_at IS NULL;
