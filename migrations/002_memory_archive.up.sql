ALTER TABLE memories ADD COLUMN deleted_at TIMESTAMPTZ;
CREATE INDEX memories_album_idx ON memories(album_id) WHERE deleted_at IS NULL;
