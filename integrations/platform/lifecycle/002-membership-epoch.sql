ALTER TABLE chief_lifecycle.member_session
  ADD COLUMN IF NOT EXISTS membership_epoch UUID;
-- Sessions created before the authority supplied an epoch must be paired again.
UPDATE chief_lifecycle.member_connection
  SET state='revoked', revoked_at=now(), generation=generation+1
  WHERE state != 'revoked' AND session_id IN
    (SELECT id FROM chief_lifecycle.member_session WHERE membership_epoch IS NULL);
UPDATE chief_lifecycle.member_session
  SET revoked_at=now(), generation=generation+1, credential=''
  WHERE membership_epoch IS NULL AND revoked_at IS NULL;
