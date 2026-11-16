-- DEV currently selects one active family; enforce this invariant in the DB.
ALTER TABLE memberships ADD CONSTRAINT one_family_per_user UNIQUE(user_id);
